/**
 * Trade arithmetic shared by paper trading, agent sessions, signal evaluation, the Signal Desk and the Lab.
 * Pure. One definition of direction, R-multiple, gross P&L and exit-side rules, so the three position
 * worlds (P14) and the four graders agree to the last digit.
 */
type LongShort = "LONG" | "SHORT";
type BuySell = "BUY" | "SELL";
export type AnySide = LongShort | BuySell;
export type Dir = 1 | -1;

/** +1 for LONG/BUY, −1 for SHORT/SELL. */
export function dirOf(side: AnySide): Dir {
  return side === "LONG" || side === "BUY" ? 1 : -1;
}

/** Price move in the trade's favour (positive = profit), in price units. */
export function favourMove(side: AnySide, entry: number, price: number): number {
  return (price - entry) * dirOf(side);
}

/** Initial risk per unit: |entry − stop|. */
export function riskPerUnit(entry: number, stop: number): number {
  return Math.abs(entry - stop);
}

/**
 * R-multiple of `price` against the entry and the initial stop. Null when the stop is at the entry
 * (no risk defined), so callers show "unavailable" instead of dividing by zero.
 */
export function rMultiple(p: { side: AnySide; entry: number; stop: number; price: number }): number | null {
  const risk = riskPerUnit(p.entry, p.stop);
  if (!(risk > 0)) return null;
  return favourMove(p.side, p.entry, p.price) / risk;
}

/** Gross P&L in quote currency for `qty` units, before fees. */
export function grossPnl(p: { side: AnySide; qty: number; entry: number }, price: number): number {
  return favourMove(p.side, p.entry, price) * p.qty;
}

/** Percentage move in the trade's favour, optionally levered. */
export function pnlPct(p: { side: AnySide; entry: number; price: number; leverage?: number }): number | null {
  if (!(p.entry > 0)) return null;
  const lev = p.leverage && p.leverage > 0 ? p.leverage : 1;
  return (favourMove(p.side, p.entry, p.price) / p.entry) * 100 * lev;
}

export type ExitProblem = { kind: "BAD_STOP" | "BAD_TARGET"; message: string } | null;

/**
 * A stop must sit on the losing side of `ref`, a target on the winning side. Returns the first
 * problem (as a code + sentence callers can throw or show) or null when both are fine.
 */
export function exitProblem(side: AnySide, ref: number, stopLoss?: number | null, takeProfit?: number | null): ExitProblem {
  const long = dirOf(side) > 0;
  if (stopLoss != null && (long ? stopLoss >= ref : stopLoss <= ref))
    return { kind: "BAD_STOP", message: `Stop-loss must be ${long ? "below" : "above"} ${ref}` };
  if (takeProfit != null && (long ? takeProfit <= ref : takeProfit >= ref))
    return { kind: "BAD_TARGET", message: `Take-profit must be ${long ? "above" : "below"} ${ref}` };
  return null;
}

/** True when `next` moves a stop toward the price (tightens) relative to `current`. */
export function tightens(side: AnySide, current: number | null | undefined, next: number): boolean {
  if (current == null) return true;
  return dirOf(side) > 0 ? next > current : next < current;
}

export type ExitKind = "stop" | "target";

/**
 * Exit price `pct` percent away from `ref` on the losing (stop) or winning (target) side,
 * e.g. a 2% stop on a LONG from 100 is 98. Lets forms take TP / SL as a distance instead of a price.
 */
export function exitFromPercent(side: AnySide, kind: ExitKind, ref: number, pct: number): number {
  const sign = kind === "target" ? dirOf(side) : -dirOf(side);
  return ref * (1 + (sign * pct) / 100);
}

/** Inverse of exitFromPercent: the distance of `price` from `ref` in percent (positive on the expected side). */
export function percentFromExit(side: AnySide, kind: ExitKind, ref: number, price: number): number {
  const sign = kind === "target" ? dirOf(side) : -dirOf(side);
  return ((price - ref) / ref) * 100 * sign;
}
