import type { Bar, ZoneLike } from "./zones";

/**
 * The system trigger and the signal's life after it (P18a), pure. Prices are in the analyst's basis: `offset`
 * (feed − analyst) is subtracted from every bar first.
 *
 * Trigger: after price touched a buy zone, a closed candle of the plan's trigger timeframe closes above the highest
 * high of the `LOOKBACK` candles before it (a small break of structure up); a sell zone mirrors it. A closed candle
 * beyond the zone's far edge first cancels the setup, and so does the window running out.
 */
export const LOOKBACK = 3;
export const TRIGGER_WINDOW_MS = 24 * 3_600_000;
export const TF_MS = { "5M": 300_000, "15M": 900_000, "1H": 3_600_000 } as const;
export type TriggerTf = keyof typeof TF_MS;
export const TRIGGER_TEXT: Record<TriggerTf, string> = { "5M": "۵ دقیقه‌ای", "15M": "۱۵ دقیقه‌ای", "1H": "یک‌ساعته" };

const shift = (b: Bar, offset: number): Bar =>
  offset ? { time: b.time, open: b.open - offset, high: b.high - offset, low: b.low - offset, close: b.close - offset } : b;

export type TriggerResult =
  | { kind: "TRIGGERED"; at: number; price: number }
  | { kind: "CANCELLED"; at: number; close: number }
  | { kind: "EXPIRED"; at: number }
  | null;

export function findTrigger(z: ZoneLike, bars: Bar[], touchedAt: number, tfMs: number, now: number, offset: number): TriggerResult {
  const up = z.kind === "BUY";
  const closed = bars.filter((b) => b.time + tfMs <= now).sort((a, b) => a.time - b.time).map((b) => shift(b, offset));
  const end = touchedAt + TRIGGER_WINDOW_MS;
  for (let i = 0; i < closed.length; i++) {
    const b = closed[i];
    // The candle containing the touch counts; earlier ones only serve as the lookback.
    if (b.time + tfMs <= touchedAt) continue;
    if (b.time >= end) break;
    if (up ? b.close < z.low : b.close > z.high) return { kind: "CANCELLED", at: b.time, close: b.close };
    const prev = closed.slice(Math.max(0, i - LOOKBACK), i);
    if (prev.length < LOOKBACK) continue;
    if (up ? b.close > Math.max(...prev.map((p) => p.high)) : b.close < Math.min(...prev.map((p) => p.low))) {
      return { kind: "TRIGGERED", at: b.time, price: b.close };
    }
  }
  return now >= end ? { kind: "EXPIRED", at: end } : null;
}

export type SignalEvent =
  | { kind: "TP"; index: number; at: number }
  | { kind: "STOP"; at: number }
  | { kind: "BREAKEVEN"; at: number };

/**
 * Walks bars from `from` and reports targets reached in order and the stop. After TP1 the stop sits at the entry
 * (risk-free). When one bar reaches both the stop and the next target, the stop is assumed first (the cautious
 * reading of a single candle). `tpHit` = targets already reported.
 */
export function trackSignal(
  side: "BUY" | "SELL", entry: number, stop: number, targets: number[], tpHit: number,
  bars: Bar[], from: number, offset: number,
): { events: SignalEvent[]; tpHit: number; closed: "STOP" | "BREAKEVEN" | "ALL_TP" | null } {
  const up = side === "BUY";
  const events: SignalEvent[] = [];
  let hit = tpHit;
  for (const raw of bars.filter((b) => b.time >= from).sort((a, b) => a.time - b.time)) {
    const b = shift(raw, offset);
    const sl = hit > 0 ? entry : stop;
    if (up ? b.low <= sl : b.high >= sl) {
      const kind = hit > 0 ? "BREAKEVEN" : "STOP";
      events.push({ kind, at: b.time });
      return { events, tpHit: hit, closed: kind };
    }
    while (hit < targets.length && (up ? b.high >= targets[hit] : b.low <= targets[hit])) {
      events.push({ kind: "TP", index: hit, at: b.time });
      hit++;
    }
    if (hit === targets.length && targets.length > 0) return { events, tpHit: hit, closed: "ALL_TP" };
  }
  return { events, tpHit: hit, closed: null };
}
