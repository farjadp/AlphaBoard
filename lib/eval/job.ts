import "server-only";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { getCandles } from "@/lib/market/candles";
import type { TimeframeKey } from "@/lib/market/timeframes";
import { evaluateSignal, normalizeTimeframe, type EvalBar, type Evaluation } from "./evaluator";

export type SignalBarsOf = (symbol: string, tf: TimeframeKey) => Promise<EvalBar[] | null>;

const MAX_PER_RUN = 1_000;

export const liveSignalBars: SignalBarsOf = async (symbol, tf) => {
  const asset = findAsset(symbol);
  if (!asset) return null;
  return (await getCandles(asset, tf)).flatMap((c) => (c.time == null ? [] : [{ ...c, time: c.time }]));
};

/**
 * Evaluate every BUY/SELL signal that has no outcome yet or is still OPEN. Candles are fetched once
 * per (symbol, timeframe) and come from the shared market cache. Resolved outcomes are final.
 */
export async function evaluatePendingSignals(opts: { now?: Date; barsOf?: SignalBarsOf } = {}) {
  const now = opts.now ?? new Date();
  const barsOf = opts.barsOf ?? liveSignalBars;
  const errors: string[] = [];

  const pending = await prisma.signal.findMany({
    where: { signal: { in: ["BUY", "SELL"] }, OR: [{ evaluation: null }, { evaluation: { status: "OPEN" } }] },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN,
    select: { id: true, symbol: true, timeframe: true, signal: true, createdAt: true, priceAtSignal: true, entry: true, stopLoss: true, takeProfit: true },
  });

  const groups = new Map<string, typeof pending>();
  for (const s of pending) {
    const key = `${s.symbol}|${normalizeTimeframe(s.timeframe) ?? s.timeframe}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  let resolved = 0;
  for (const [key, signals] of groups) {
    const [symbol] = key.split("|");
    const tf = normalizeTimeframe(signals[0].timeframe);
    let bars: EvalBar[] = [];
    if (tf && findAsset(symbol)) {
      try {
        bars = (await barsOf(symbol, tf)) ?? [];
      } catch (e) {
        errors.push(`${key}: ${e instanceof Error ? e.message : e}`);
        continue; // market data down: try again next tick, never guess
      }
      if (bars.length === 0) continue;
    }
    for (const s of signals) {
      const ev: Evaluation | null = findAsset(symbol)
        ? evaluateSignal(s, bars, now)
        : { status: "INVALID", note: `Unsupported symbol ${symbol}`, rMultiple: null, exitPrice: null, entryFilledAt: null, resolvedAt: null, barsElapsed: 0 };
      if (!ev) continue;
      const data = { ...ev, lastCheckedAt: now };
      await prisma.signalEvaluation.upsert({ where: { signalId: s.id }, create: { signalId: s.id, ...data }, update: data });
      if (ev.status !== "OPEN") resolved++;
    }
  }
  return { checked: pending.length, resolved, errors };
}
