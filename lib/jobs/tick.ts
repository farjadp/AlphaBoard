import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { logger } from "@/lib/http/logger";
import { getCandles } from "@/lib/market/candles";
import { livePrice, settlePosition, snapshotEquity, type PriceOf } from "@/lib/paper/account";
import { scanExit, type Bar } from "@/lib/paper/engine";

export const TICK_KEY = "tick.last";
const SNAPSHOT_EVERY_MS = 15 * 60_000;

export interface TickDeps {
  now?: () => Date;
  /** Recent 5m candles for a symbol, oldest first; null when unavailable. */
  barsOf?: (symbol: string) => Promise<Bar[] | null>;
  priceOf?: PriceOf;
}

export interface TickResult {
  at: string;
  ms: number;
  positions: number;
  symbols: number;
  closed: Array<{ id: string; symbol: string; reason: string }>;
  snapshots: number;
  errors: string[];
}

const liveBars = async (symbol: string): Promise<Bar[] | null> => {
  const asset = findAsset(symbol);
  if (!asset) return null;
  return (await getCandles(asset, "5M")).flatMap((c) => (c.time == null ? [] : [{ ...c, time: c.time }]));
};

/**
 * One scheduler tick: settle paper positions whose SL/TP/liquidation level was crossed by a candle
 * high/low (or the live quote), then snapshot equity for active accounts. Alerts (P6) and signal
 * evaluation (P5) join here later.
 */
export async function runTick(deps: TickDeps = {}): Promise<TickResult> {
  const now = deps.now ?? (() => new Date());
  const barsOf = deps.barsOf ?? liveBars;
  const priceOf = deps.priceOf ?? livePrice;
  const started = now();
  const errors: string[] = [];
  const closed: TickResult["closed"] = [];

  const open = await prisma.paperPosition.findMany({ where: { closedAt: null }, orderBy: { openedAt: "asc" }, take: 5_000 });
  const symbols = [...new Set(open.map((p) => p.symbol))];
  const market = new Map(await Promise.all(symbols.map(async (s) => {
    const [bars, price] = await Promise.all([
      barsOf(s).catch((e) => { errors.push(`${s} candles: ${e instanceof Error ? e.message : e}`); return null; }),
      priceOf(s).catch(() => null),
    ]);
    return [s, { bars: bars ?? [], price }] as const;
  })));

  for (const pos of open) {
    const m = market.get(pos.symbol)!;
    const t = now().getTime();
    // The live quote is a zero-range bar "now": it covers the entry candle, which scanExit skips.
    const bars = m.price != null ? [...m.bars, { time: t, open: m.price, high: m.price, low: m.price, close: m.price }] : m.bars;
    if (bars.length === 0) continue;
    try {
      const exit = scanExit(pos, bars, pos.lastCheckedAt.getTime());
      if (exit) {
        const r = await settlePosition(pos, exit.reason, exit.level, now());
        if (r) closed.push({ id: pos.id, symbol: pos.symbol, reason: exit.reason });
        continue;
      }
      // Re-scan the still-forming candle next time; never move back before the entry.
      const latestStart = Math.max(...m.bars.map((b) => b.time), 0);
      if (latestStart > pos.lastCheckedAt.getTime()) {
        await prisma.paperPosition.updateMany({ where: { id: pos.id, closedAt: null }, data: { lastCheckedAt: new Date(latestStart) } });
      }
    } catch (e) {
      errors.push(`${pos.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Equity curve: accounts that traded this tick or hold positions, at most every 15 minutes.
  const due = new Date(now().getTime() - SNAPSHOT_EVERY_MS);
  const accounts = await prisma.paperAccount.findMany({
    where: {
      OR: [{ id: { in: [...new Set(open.filter((p) => closed.some((c) => c.id === p.id)).map((p) => p.accountId))] } },
        { positions: { some: { closedAt: null } }, OR: [{ snapshotAt: null }, { snapshotAt: { lt: due } }] }],
    },
    select: { id: true },
  });
  const cachedPrice: PriceOf = (s) => Promise.resolve(market.get(s)?.price ?? null).then((p) => p ?? priceOf(s));
  let snapshots = 0;
  for (const a of accounts) {
    try {
      if ((await snapshotEquity(a.id, cachedPrice, now())) != null) snapshots++;
    } catch (e) {
      errors.push(`snapshot ${a.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const result: TickResult = {
    at: started.toISOString(), ms: now().getTime() - started.getTime(),
    positions: open.length, symbols: symbols.length, closed, snapshots, errors: errors.slice(0, 20),
  };
  const value = result as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: TICK_KEY }, create: { key: TICK_KEY, value }, update: { value } });
  if (errors.length) logger.warn({ ...result }, "tick finished with errors");
  else if (closed.length) logger.info({ ...result }, "tick settled positions");
  return result;
}
