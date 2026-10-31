/**
 * How far a position went for and against it while open (MFE / MAE), in R — the numbers that tell a
 * stop-in-the-noise loss (deep MAE, no MFE) from a good idea exited badly (MFE ≥ 1R, then lost). Pure.
 */
import { favourMove, riskPerUnit } from "@/lib/trading/math";

type Side = "LONG" | "SHORT";

/** The new best / worst price after seeing `price`, or null when neither moved (no write needed). */
export function nextExtremes(p: { side: Side; entryPrice: number; bestPrice: number | null; worstPrice: number | null }, price: number) {
  const long = p.side === "LONG";
  const best = p.bestPrice ?? p.entryPrice;
  const worst = p.worstPrice ?? p.entryPrice;
  const nb = long ? Math.max(best, price) : Math.min(best, price);
  const nw = long ? Math.min(worst, price) : Math.max(worst, price);
  if (p.bestPrice != null && p.worstPrice != null && nb === best && nw === worst) return null;
  return { bestPrice: nb, worstPrice: nw };
}

export interface Excursion { mfeR: number; maeR: number }

/** Best move in favour and worst move against, both as positive multiples of the initial risk (entry → stop). */
export function excursionR(p: { side: Side; entryPrice: number; initialStop: number | null; bestPrice: number | null; worstPrice: number | null; closePrice?: number | null }): Excursion | null {
  if (p.initialStop == null) return null;
  const r = riskPerUnit(p.entryPrice, p.initialStop);
  if (!(r > 0)) return null;
  const seen = [p.bestPrice, p.worstPrice, p.closePrice].filter((x): x is number => x != null);
  const favour = (x: number) => favourMove(p.side, p.entryPrice, x);
  const moves = seen.map(favour);
  return { mfeR: Math.max(0, ...moves) / r, maeR: Math.max(0, ...moves.map((m) => -m)) / r };
}
