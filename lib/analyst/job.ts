import "server-only";
import type { AnalystZone } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { findAsset } from "@/lib/market/catalog";
import { logger } from "@/lib/http/logger";
import { getCandles } from "@/lib/market/candles";
import { env } from "@/lib/env";
import { channelFromEnv, type Channel } from "@/lib/signalDesk/channel";
import { notify } from "@/lib/notify/notifications";
import type { Telegram } from "@/lib/notify/telegram";
import type { PriceOf } from "@/lib/paper/account";
import { calculateIndicatorSnapshot, computeAtr } from "@/lib/market/indicators";
import { exitsFor, riskLevel } from "./exits";
import { noTriggerMessage, signalMessage, signalPost, stepMessage, stepPost, zoneMessage, type SignalInfo, type SignalStep } from "./message";
import { findTrigger, trackSignal, TF_MS as TRIGGER_TF_MS, type TriggerTf } from "./trigger";
import { agreements, closedBeyond, nearEvent, scoreReaction, zoneTouched, type Bar } from "./zones";

/**
 * The worker's analyst-plan step (P18a), run in every tick: expire plans past their week, mark zones price
 * reached, mark invalidation levels a closed candle broke, wait for the system trigger after a buy/sell touch, follow
 * the signal it starts (targets, stop, breakeven), and score how price reacted after a touch. Every state change
 * is an `updateMany` guarded on the old state, so each step notifies at most once. It never places an order.
 *
 * Channel (plans with postToChannel): only the signal when its trigger fires, then every later step of that signal
 * as a reply under it. Zone touches, analyst targets and triggers that never came stay private.
 */
type Tf = "15M" | "1H" | "4H" | "1D";
const TF_MS: Record<Tf, number> = { "15M": 900_000, "1H": 3_600_000, "4H": 4 * 3_600_000, "1D": 24 * 3_600_000 };
/** A signal nobody closed is no longer followed after this long. */
export const SIGNAL_MAX_DAYS = 14;

export interface ZoneJobDeps {
  now: Date;
  /** Recent 5m candles, oldest first; null when unavailable. */
  barsOf: (symbol: string) => Promise<Bar[] | null>;
  /** Candles of a larger timeframe (scoring and invalidation closes). */
  barsTfOf?: (symbol: string, tf: Tf) => Promise<Bar[] | null>;
  priceOf: PriceOf;
  telegram: Telegram | null;
  /** Public signals channel for plans with postToChannel; defaults to SIGNAL_BOT_TOKEN + SIGNAL_CHANNEL_ID. */
  channel?: Channel | null;
  channelUsername?: string | null;
}

const tfBars = async (symbol: string, tf: Tf): Promise<Bar[] | null> => {
  const asset = findAsset(symbol);
  if (!asset) return null;
  return (await getCandles(asset, tf)).flatMap((c) => (c.time == null || c.close <= 0 ? [] : [{ ...c, time: c.time }]));
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const triggerTfOf = (v: string): TriggerTf => (v === "5M" || v === "1H" ? v : "15M");
/** A stored signal's entry and exits, as the texts need them. */
const signalOf = (z: AnalystZone): Pick<SignalInfo, "entry" | "stopPct" | "targets"> => ({
  entry: z.triggerPrice ?? z.enteredPrice ?? z.low,
  stopPct: z.signalStopPct ?? 0,
  targets: z.signalTargets.map((price, i) => ({ price, pct: z.signalTargetPcts[i] ?? 0 })),
});

export async function evaluateZones(deps: ZoneJobDeps) {
  const now = deps.now;
  const t = now.getTime();
  const barsTfOf = deps.barsTfOf ?? tfBars;
  const channel = deps.channel === undefined ? channelFromEnv() : deps.channel;
  const username = deps.channelUsername === undefined ? env().SIGNAL_CHANNEL_USERNAME ?? null : deps.channelUsername;
  /** Best effort, after the owner was told: a failed post is kept on the zone and never retried. */
  const post = async (zoneId: string, text: string) => {
    try {
      if (!channel) throw new Error("channel not configured (SIGNAL_BOT_TOKEN / SIGNAL_CHANNEL_ID)");
      const id = await channel.post(text);
      await prisma.analystZone.update({ where: { id: zoneId }, data: { channelMessageId: id } });
    } catch (e) {
      logger.warn({ err: msg(e), zoneId }, "analyst channel post failed");
      await prisma.analystZone.update({ where: { id: zoneId }, data: { channelError: msg(e).slice(0, 300) } }).catch(() => {});
    }
  };
  const reply = async (zoneId: string, messageId: number | null, text: string) => {
    if (!channel || messageId == null) return;
    try {
      await channel.reply(messageId, text);
    } catch (e) {
      logger.warn({ err: msg(e), zoneId }, "analyst channel reply failed");
      await prisma.analystZone.update({ where: { id: zoneId }, data: { channelError: msg(e).slice(0, 300) } }).catch(() => {});
    }
  };
  const errors: string[] = [];
  let entered = 0, broken = 0, scored = 0, expired = 0, triggered = 0, steps = 0;

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

  // A source's reached zones and how many held, once per owner + source per tick.
  const records = new Map<string, Promise<{ touched: number; respected: number }>>();
  const recordOf = (userId: string, source: string) => {
    const key = `${userId} ${source.trim().toLowerCase()}`;
    if (!records.has(key)) {
      records.set(key, prisma.analystZone.findMany({
        where: { plan: { userId, source: { equals: source.trim(), mode: "insensitive" } }, outcome: { in: ["RESPECTED", "BROKE", "UNCLEAR"] } },
        select: { outcome: true },
      }).then((rows) => ({ touched: rows.length, respected: rows.filter((r) => r.outcome === "RESPECTED").length })));
    }
    return records.get(key)!;
  };

  /** Exits from the entry and the rule-based risk level, for a trigger that just fired. */
  const signalFor = async (p: { userId: string; source: string; stopPct: number; targetPcts: number[]; triggerTf: string }, z: AnalystZone, price: number, newsRisk: string | null): Promise<SignalInfo> => {
    const side = z.kind === "BUY" ? "BUY" : "SELL";
    const { stop, targets } = exitsFor(side, price, p.stopPct, p.targetPcts);
    const [bars4h, bars1h, bars5m, record] = await Promise.all([
      load(`${z.symbol} 4H`, () => barsTfOf(z.symbol, "4H")),
      load(`${z.symbol} 1H`, () => barsTfOf(z.symbol, "1H")),
      fiveMin(z.symbol),
      recordOf(p.userId, p.source),
    ]);
    const trend = calculateIndicatorSnapshot("4H", bars4h);
    const lastHour = bars5m.filter((b) => b.time > t - 3_600_000);
    return {
      entry: price, stop, stopPct: p.stopPct, triggerTf: triggerTfOf(p.triggerTf),
      targets: targets.map((x, i) => ({ price: x, pct: p.targetPcts[i] })),
      risk: riskLevel({
        side,
        trend4h: trend.available === false ? null : trend.trendSignal ?? null,
        newsRisk,
        atr1h: computeAtr(bars1h),
        lastHourRange: lastHour.length ? Math.max(...lastHour.map((b) => b.high)) - Math.min(...lastHour.map((b) => b.low)) : null,
        record,
      }),
    };
  };

  const invalidationFor = (zones: AnalystZone[], z: AnalystZone) => {
    // A buy is cancelled by a close below, a sell by a close above.
    const side = z.kind === "BUY" ? "BELOW" : z.kind === "SELL" ? "ABOVE" : null;
    return zones.find((o) => o.kind === "INVALIDATION" && o.symbol === z.symbol && o.state === "WAITING" && o.direction === side) ?? null;
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
              // Open signals of this plan on the side this level cancels get the news under their post.
              const cancels = z.direction === "BELOW" ? "BUY" : "SELL";
              for (const o of p.zones.filter((o) => o.symbol === z.symbol && o.kind === cancels && o.signalState === "OPEN")) {
                await reply(o.id, o.channelMessageId, stepPost(o, signalOf(o), { kind: "BROKEN", level: z }));
              }
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
              : { state: "ENTERED", enteredAt: new Date(hit.at), enteredPrice: hit.price, signalState: "WAITING_TRIGGER" },
          });
          if (done.count === 1) {
            entered++;
            const ctx = {
              planId: p.id, source: p.source, price: hit.price, agrees: agree.get(z.id) ?? [], newsRisk: nearEvent(hit.at, events),
              invalidation: target ? null : invalidationFor(p.zones, z), triggerTf: triggerTfOf(p.triggerTf),
            };
            await notify(p.userId, zoneMessage(target ? "HIT" : "ENTERED", z, ctx), deps.telegram);
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

  // 3. Triggers after a buy/sell touch, then the signals they start. Followed even after the plan is archived.
  const signals = await prisma.analystZone.findMany({
    where: { signalState: { in: ["WAITING_TRIGGER", "OPEN"] } },
    include: { plan: { select: { id: true, userId: true, source: true, offsets: true, events: true, postToChannel: true, stopPct: true, targetPcts: true, triggerTf: true, zones: true } } },
    take: 2_000,
  });
  for (const z of signals) {
    const p = z.plan;
    const offset = offsetOf(p.offsets, z.symbol);
    const owner = { planId: p.id, source: p.source };
    try {
      if (z.signalState === "WAITING_TRIGGER") {
        const tf = triggerTfOf(p.triggerTf);
        const bars = tf === "5M" ? await load(`${z.symbol} 5M`, () => deps.barsOf(z.symbol)) : await load(`${z.symbol} ${tf}`, () => barsTfOf(z.symbol, tf));
        const r = findTrigger(z, bars, z.enteredAt!.getTime(), TRIGGER_TF_MS[tf], t, offset);
        if (!r) continue;
        if (r.kind !== "TRIGGERED") {
          const done = await prisma.analystZone.updateMany({ where: { id: z.id, signalState: "WAITING_TRIGGER" }, data: { signalState: r.kind, signalClosedAt: now } });
          if (done.count === 1) await notify(p.userId, noTriggerMessage(z, r.kind, r.kind === "CANCELLED" ? r.close : null, owner), deps.telegram);
          continue;
        }
        const events = Array.isArray(p.events) ? (p.events as Array<{ at: string; label: string }>) : [];
        const s = await signalFor(p, z, r.price, nearEvent(r.at, events));
        const done = await prisma.analystZone.updateMany({
          where: { id: z.id, signalState: "WAITING_TRIGGER" },
          data: {
            signalState: "OPEN", triggeredAt: new Date(r.at), triggerPrice: r.price, signalStop: s.stop, signalStopPct: s.stopPct,
            signalTargets: s.targets.map((x) => x.price), signalTargetPcts: s.targets.map((x) => x.pct), tpHit: 0,
            signalCheckedAt: new Date(r.at + TRIGGER_TF_MS[tf]),
          },
        });
        if (done.count !== 1) continue;
        triggered++;
        const invalidation = invalidationFor(p.zones, z);
        await notify(p.userId, signalMessage(z, s, { ...owner, agrees: agree.get(z.id) ?? [], invalidation }), deps.telegram);
        if (p.postToChannel) await post(z.id, signalPost(z, s, invalidation, username));
        continue;
      }

      // OPEN: targets, stop, breakeven; or stop following after SIGNAL_MAX_DAYS.
      const info = signalOf(z);
      const side = z.kind === "BUY" ? "BUY" : "SELL";
      const timedOut = t - z.triggeredAt!.getTime() > SIGNAL_MAX_DAYS * 86_400_000;
      const bars = timedOut ? [] : await fiveMin(z.symbol);
      const r = timedOut
        ? { events: [], tpHit: z.tpHit, closed: null }
        : trackSignal(side, info.entry, z.signalStop!, z.signalTargets, z.tpHit, bars, z.signalCheckedAt?.getTime() ?? z.triggeredAt!.getTime(), offset);
      const stepsNow: SignalStep[] = r.events.map((e) => (e.kind === "TP" ? { kind: "TP", index: e.index } : { kind: e.kind }));
      if (r.closed === "ALL_TP") stepsNow.push({ kind: "ALL_TP" });
      if (timedOut) stepsNow.push({ kind: "TIMEOUT", days: SIGNAL_MAX_DAYS });
      const closed = timedOut ? "TIMEOUT" : r.closed;
      const latest = Math.max(...bars.filter((b) => b.time < t).map((b) => b.time), z.signalCheckedAt?.getTime() ?? 0);
      const done = await prisma.analystZone.updateMany({
        where: { id: z.id, signalState: "OPEN", tpHit: z.tpHit },
        data: { tpHit: r.tpHit, signalCheckedAt: new Date(latest), ...(closed ? { signalState: closed, signalClosedAt: now } : {}) },
      });
      if (done.count !== 1) continue;
      for (const step of stepsNow) {
        steps++;
        await notify(p.userId, stepMessage(z, info, step, owner), deps.telegram);
        await reply(z.id, z.channelMessageId, stepPost(z, info, step));
      }
    } catch (e) {
      errors.push(`signal ${z.id}: ${msg(e)}`);
    }
  }

  // 4. Reactions after a touch.
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

  return { active: plans.length, entered, broken, scored, expired, triggered, steps, errors };
}
