/**
 * How far a position went for and against it while open (MFE / MAE) and its R at any price. Pure. These are
 * the numbers that tell a stop-in-the-noise loss (deep MAE, no MFE) from a good idea exited badly (MFE ≥ 1R).
 */
import { favourMove, riskPerUnit, rMultiple } from "@/lib/trading/math";
import type { TrackedPosition } from "./types";

type Seen = number | { high: number; low: number };

/** New best / worst after seeing a price or a bar's range, or null when neither moved (no write needed). */
export function nextExtremes(p: Pick<TrackedPosition, "side" | "entryPrice" | "bestPrice" | "worstPrice">, seen: Seen) {
  const long = p.side === "LONG";
  const hi = typeof seen === "number" ? seen : seen.high;
  const lo = typeof seen === "number" ? seen : seen.low;
  const best = p.bestPrice ?? p.entryPrice;
  const worst = p.worstPrice ?? p.entryPrice;
  const nb = long ? Math.max(best, hi) : Math.min(best, lo);
  const nw = long ? Math.min(worst, lo) : Math.max(worst, hi);
  if (p.bestPrice != null && p.worstPrice != null && nb === best && nw === worst) return null;
  return { bestPrice: nb, worstPrice: nw };
}

export interface Excursion { mfeR: number; maeR: number }

/** Best move in favour and worst move against, as positive multiples of the initial risk. Null without a stop. */
export function excursionR(p: Pick<TrackedPosition, "side" | "entryPrice" | "initialStop" | "bestPrice" | "worstPrice"> & { closePrice?: number | null }): Excursion | null {
  if (p.initialStop == null) return null;
  const r = riskPerUnit(p.entryPrice, p.initialStop);
  if (!(r > 0)) return null;
  const moves = [p.bestPrice, p.worstPrice, p.closePrice].filter((x): x is number => x != null).map((x) => favourMove(p.side, p.entryPrice, x));
  return { mfeR: Math.max(0, ...moves) / r, maeR: Math.max(0, ...moves.map((m) => -m)) / r };
}

/** R of `price` against the initial stop (falls back to the current stop when none was recorded). */
export function positionR(p: Pick<TrackedPosition, "side" | "entryPrice" | "initialStop" | "stopLoss">, price: number | null | undefined): number | null {
  const stop = p.initialStop ?? p.stopLoss;
  if (price == null || stop == null) return null;
  return rMultiple({ side: p.side, entry: p.entryPrice, stop, price });
}
