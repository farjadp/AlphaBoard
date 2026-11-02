import "server-only";
import type { AnalystZone } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { findAsset } from "@/lib/market/catalog";
import { getCandles } from "@/lib/market/candles";
import { notify } from "@/lib/notify/notifications";
import type { Telegram } from "@/lib/notify/telegram";
import type { PriceOf } from "@/lib/paper/account";
import { zoneMessage } from "./message";
import { agreements, closedBeyond, nearEvent, scoreReaction, zoneTouched, type Bar } from "./zones";

/**
 * The worker's analyst-plan step (P18a), run in every tick: expire plans past their week, mark zones price
 * reached (one notification each), mark invalidation levels a closed candle broke, and score how price reacted
 * after a touch. Every state change is an `updateMany` guarded on the old state, so a zone notifies at most once.
 * It never places an order.
 */
type Tf = "1H" | "4H" | "1D";
const TF_MS: Record<Tf, number> = { "1H": 3_600_000, "4H": 4 * 3_600_000, "1D": 24 * 3_600_000 };

export interface ZoneJobDeps {
  now: Date;
  /** Recent 5m candles, oldest first; null when unavailable. */
  barsOf: (symbol: string) => Promise<Bar[] | null>;
  /** Candles of a larger timeframe (scoring and invalidation closes). */
  barsTfOf?: (symbol: string, tf: Tf) => Promise<Bar[] | null>;
  priceOf: PriceOf;
  telegram: Telegram | null;
}

const tfBars = async (symbol: string, tf: Tf): Promise<Bar[] | null> => {
  const asset = findAsset(symbol);
  if (!asset) return null;
  return (await getCandles(asset, tf)).flatMap((c) => (c.time == null || c.close <= 0 ? [] : [{ ...c, time: c.time }]));
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function evaluateZones(deps: ZoneJobDeps) {
  const now = deps.now;
  const t = now.getTime();
  const barsTfOf = deps.barsTfOf ?? tfBars;
  const errors: string[] = [];
  let entered = 0, broken = 0, scored = 0, expired = 0;

  // 1. Plans past their expiry: untouched zones get their final outcome, the plan is archived.
  const ending = await prisma.analystPlan.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, select: { id: true } });
  for (const p of ending) {
    const ids = { planId: p.id, state: "WAITING" as const };
    await prisma.$transaction([
      prisma.analystZone.updateMany({ where: { ...ids, kind: { in: ["BUY", "SELL"] } }, data: { state: "EXPIRED", outcome: "UNTOUCHED", scoredAt: now } }),
      prisma.analystZone.updateMany({ where: { ...ids, kind: "TARGET" }, data: { state: "EXPIRED", outcome: "MISSED", scoredAt: now } }),
      prisma.analystZone.updateMany({ where: ids, data: { state: "EXPIRED" } }),
      prisma.analystPlan.updateMany({ where: { id: p.id, status: "ACTIVE" }, data: { status: "ARCHIVED" } }),
    ]);
    expired++;
  }

  const plans = await prisma.analystPlan.findMany({ where: { status: "ACTIVE" }, include: { zones: true }, take: 500 });
  // Zones touched earlier keep being scored even after their plan was archived.
  const scoring = await prisma.analystZone.findMany({
    where: { state: "ENTERED", kind: { in: ["BUY", "SELL"] } },
    include: { plan: { select: { offsets: true } } },
    take: 2_000,
  });

  // Market data, fetched once per symbol and timeframe.
  const cache = new Map<string, Promise<Bar[]>>();
  const load = (key: string, f: () => Promise<Bar[] | null>) => {
    if (!cache.has(key)) cache.set(key, f().then((b) => b ?? []).catch((e) => { errors.push(`${key}: ${msg(e)}`); return []; }));
    return cache.get(key)!;
  };
  const quotes = new Map<string, Promise<number | null>>();
  const quote = (s: string) => {
    if (!quotes.has(s)) quotes.set(s, deps.priceOf(s).catch(() => null));
    return quotes.get(s)!;
  };
  const fiveMin = async (s: string) => {
    const [bars, price] = await Promise.all([load(`${s} 5M`, () => deps.barsOf(s)), quote(s)]);
    return price != null ? [...bars, { time: t, open: price, high: price, low: price, close: price }] : bars;
  };
  const offsetOf = (offsets: unknown, symbol: string) => {
    const v = (offsets as Record<string, unknown> | null)?.[symbol];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };

  // Agreement across each owner's active plans.
  const byUser = new Map<string, Array<AnalystZone & { source: string }>>();
  for (const p of plans) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), ...p.zones.map((z) => ({ ...z, source: p.source }))]);
  const agree = new Map<string, string[]>();
  for (const zs of byUser.values()) for (const [k, v] of agreements(zs)) agree.set(k, v);

  // 2. Touches and broken invalidations.
  for (const p of plans) {
    const events = Array.isArray(p.events) ? (p.events as Array<{ at: string; label: string }>) : [];
    for (const z of p.zones) {
      if (z.state !== "WAITING" || z.kind === "INFO") continue;
      const offset = offsetOf(p.offsets, z.symbol);
      try {
        if (z.kind === "INVALIDATION") {
          const tf = (z.closeTf ?? "4H") as Tf;
          const bars = await load(`${z.symbol} ${tf}`, () => barsTfOf(z.symbol, tf));
          // Include the candle that was already open when the plan was activated.
          const hit = closedBeyond(z, bars, z.lastCheckedAt.getTime() - TF_MS[tf] + 1, TF_MS[tf], t, offset);
          if (hit) {
            const done = await prisma.analystZone.updateMany({ where: { id: z.id, state: "WAITING" }, data: { state: "BROKEN", enteredAt: new Date(hit.at), enteredPrice: hit.close } });
            if (done.count === 1) {
              broken++;
              await notify(p.userId, zoneMessage("BROKEN", z, { planId: p.id, source: p.source, price: hit.close, agrees: [], newsRisk: null, invalidation: null }), deps.telegram);
            }
          }
          continue;
        }
        const bars = await fiveMin(z.symbol);
        if (bars.length === 0) continue;
        const hit = zoneTouched(z, bars, z.lastCheckedAt.getTime(), offset);
        if (hit) {
          const target = z.kind === "TARGET";
          const done = await prisma.analystZone.updateMany({
            where: { id: z.id, state: "WAITING" },
            data: target
              ? { state: "SCORED", outcome: "HIT", enteredAt: new Date(hit.at), enteredPrice: hit.price, scoredAt: now }
              : { state: "ENTERED", enteredAt: new Date(hit.at), enteredPrice: hit.price },
          });
          if (done.count === 1) {
            entered++;
            const invalidation = p.zones.find((o) => o.kind === "INVALIDATION" && o.symbol === z.symbol && o.state === "WAITING") ?? null;
            await notify(p.userId, zoneMessage(target ? "HIT" : "ENTERED", z, {
              planId: p.id, source: p.source, price: hit.price, agrees: agree.get(z.id) ?? [], newsRisk: nearEvent(hit.at, events), invalidation,
            }), deps.telegram);
          }
          continue;
        }
        const latest = Math.max(...bars.filter((b) => b.time < t).map((b) => b.time), 0);
        if (latest > z.lastCheckedAt.getTime()) {
          await prisma.analystZone.updateMany({ where: { id: z.id, state: "WAITING" }, data: { lastCheckedAt: new Date(latest) } });
        }
      } catch (e) {
        errors.push(`zone ${z.id}: ${msg(e)}`);
      }
    }
  }

  // 3. Reactions after a touch.
  for (const z of scoring) {
    try {
      const bars = await load(`${z.symbol} 1H`, () => barsTfOf(z.symbol, "1H"));
      const s = scoreReaction(z, bars, z.enteredAt!.getTime(), t, offsetOf(z.plan.offsets, z.symbol));
      if (!s) continue;
      const done = await prisma.analystZone.updateMany({ where: { id: z.id, state: "ENTERED" }, data: { state: "SCORED", outcome: s.outcome, mfe: s.mfe, mae: s.mae, scoredAt: now } });
      scored += done.count;
    } catch (e) {
      errors.push(`score ${z.id}: ${msg(e)}`);
    }
  }

  return { active: plans.length, entered, broken, scored, expired, errors };
}
