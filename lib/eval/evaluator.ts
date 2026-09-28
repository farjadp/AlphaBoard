/**
 * Signal evaluation (spec D10), pure: replays an archived AI signal against the candles of its own
 * timeframe and decides TP_HIT / SL_HIT / EXPIRED / NO_FILL (or keeps it OPEN). Stateless — the same
 * signal and bars always give the same answer, so the tick can simply re-run it until it resolves.
 *
 * Rules (all conservative — they never flatter the model):
 * - Bars that started before the signal are ignored (their extremes may predate it).
 * - Entry within 0.1% of the price the model saw counts as filled immediately; otherwise the entry
 *   fills when price trades through it (a limit/stop entry). A signal that never fills is NO_FILL,
 *   excluded from win rate.
 * - On the fill bar only the stop counts (we cannot know whether the target traded after the fill).
 * - Stop and target in the same bar → the stop. A bar that opens beyond the stop exits at the open.
 * - Horizon: a fixed number of bars per timeframe; a filled signal still open then is EXPIRED at
 *   that bar's close. No fees — this measures the call, not an execution.
 * - R = (exit − entry) × direction / |entry − stop|.
 */
import type { TimeframeKey } from "@/lib/market/timeframes";
import { TIMEFRAME_KEYS } from "@/lib/market/timeframes";

export type SignalOutcome = "OPEN" | "TP_HIT" | "SL_HIT" | "EXPIRED" | "NO_FILL" | "INVALID";

export interface EvalSignal {
  signal: string;
  timeframe: string;
  createdAt: Date;
  priceAtSignal: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
}

export interface EvalBar { time: number; open: number; high: number; low: number; close: number }

export interface Evaluation {
  status: SignalOutcome;
  rMultiple: number | null;
  exitPrice: number | null;
  entryFilledAt: Date | null;
  resolvedAt: Date | null;
  barsElapsed: number;
  note: string | null;
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** Bars a signal has to play out: ≈ one day on 15M, three days on 1H, a week on 4H, a month on 1D. */
export const HORIZON_BARS: Record<TimeframeKey, number> = { "5M": 144, "15M": 96, "1H": 72, "4H": 42, "1D": 30, "1W": 12, "1M": 6 };
export const BAR_MS: Record<TimeframeKey, number> = { "5M": 5 * MIN, "15M": 15 * MIN, "1H": HOUR, "4H": 4 * HOUR, "1D": DAY, "1W": 7 * DAY, "1M": 31 * DAY };
const MARKET_ENTRY_TOLERANCE = 0.001;

export function normalizeTimeframe(tf: string): TimeframeKey | null {
  const up = tf.trim().toUpperCase();
  // "1M" is the monthly key; minutes are spelled 5M/15M, so there is no ambiguity after upper-casing.
  return (TIMEFRAME_KEYS as readonly string[]).includes(up) ? (up as TimeframeKey) : null;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function evaluateSignal(s: EvalSignal, bars: EvalBar[], now: Date): Evaluation | null {
  const dir = s.signal === "BUY" ? 1 : s.signal === "SELL" ? -1 : 0;
  if (!dir) return null;
  const base = { rMultiple: null, exitPrice: null, entryFilledAt: null, resolvedAt: null, barsElapsed: 0 };
  const invalid = (note: string): Evaluation => ({ status: "INVALID", note, ...base });

  const tf = normalizeTimeframe(s.timeframe);
  if (!tf) return invalid(`Unknown timeframe "${s.timeframe}"`);
  const valid = dir === 1 ? s.stopLoss < s.entry && s.entry < s.takeProfit : s.takeProfit < s.entry && s.entry < s.stopLoss;
  if (!valid || !(s.stopLoss > 0)) return invalid("Stop/target levels are on the wrong side of the entry");

  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const t0 = s.createdAt.getTime();
  if (sorted.length === 0 || sorted[0].time > t0) return invalid("Price history no longer covers this signal");

  const risk = Math.abs(s.entry - s.stopLoss);
  const R = (exit: number) => round(((exit - s.entry) * dir) / risk);
  const horizon = HORIZON_BARS[tf];
  const after = sorted.filter((b) => b.time >= t0).slice(0, horizon);

  let filledAt: Date | null = Math.abs(s.entry - s.priceAtSignal) / s.priceAtSignal <= MARKET_ENTRY_TOLERANCE ? s.createdAt : null;
  let lo = s.priceAtSignal, hi = s.priceAtSignal;

  for (let i = 0; i < after.length; i++) {
    const b = after[i];
    const at = new Date(b.time);
    const stopHit = dir === 1 ? b.low <= s.stopLoss : b.high >= s.stopLoss;
    const stopExit = (dir === 1 ? b.open < s.stopLoss : b.open > s.stopLoss) ? b.open : s.stopLoss;
    const done = (status: SignalOutcome, exit: number): Evaluation =>
      ({ status, rMultiple: R(exit), exitPrice: exit, entryFilledAt: filledAt, resolvedAt: at, barsElapsed: i + 1, note: null });

    if (!filledAt) {
      lo = Math.min(lo, b.low);
      hi = Math.max(hi, b.high);
      if (lo <= s.entry && s.entry <= hi) {
        filledAt = at;
        // The fill bar: the stop may have traded after the fill; the target cannot be credited.
        if (stopHit) return done("SL_HIT", s.stopLoss);
      }
      continue;
    }
    if (stopHit) return done("SL_HIT", stopExit);
    if (dir === 1 ? b.high >= s.takeProfit : b.low <= s.takeProfit) return done("TP_HIT", s.takeProfit);
  }

  const last = after.at(-1);
  const horizonComplete = after.length === horizon && !!last && last.time + BAR_MS[tf] <= now.getTime();
  if (horizonComplete) {
    return filledAt
      ? { status: "EXPIRED", rMultiple: R(last!.close), exitPrice: last!.close, entryFilledAt: filledAt, resolvedAt: new Date(last!.time + BAR_MS[tf]), barsElapsed: horizon, note: null }
      : { status: "NO_FILL", ...base, resolvedAt: new Date(last!.time + BAR_MS[tf]), barsElapsed: horizon, note: "Entry never traded within the horizon" };
  }
  return { status: "OPEN", ...base, entryFilledAt: filledAt, barsElapsed: after.length, note: null };
}
