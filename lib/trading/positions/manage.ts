/**
 * Stop and target management rules, the same for paper, sessions and (mirrored in MQL5) the Signal Desk.
 * Every function is pure and answers "what should the stop be now", never touching a venue.
 */
import { dirOf, exitProblem, favourMove, tightens } from "@/lib/trading/math";
import type { Side, TrackedPosition } from "./types";

export type ManageProblem = { code: "NOT_IN_PROFIT" | "ALREADY_PROTECTED" | "NO_ATR" | "BAD_LEVEL"; message: string };
export type StopDecision = { stop: number } | { problem: ManageProblem };

/**
 * Breakeven = entry plus a buffer in the trade's favour (covers spread and fees; 0 = exactly the entry).
 * Allowed once the price is past that level; refused when the stop already protects at least that much.
 */
export function breakevenStop(p: Pick<TrackedPosition, "side" | "entryPrice" | "stopLoss">, price: number, buffer = 0): StopDecision {
  const dir = dirOf(p.side);
  const be = p.entryPrice + dir * Math.max(0, buffer);
  if (favourMove(p.side, be, price) <= 0) return { problem: { code: "NOT_IN_PROFIT", message: `Price ${price} has not moved past ${be} yet` } };
  if (p.stopLoss != null && !tightens(p.side, p.stopLoss, be)) return { problem: { code: "ALREADY_PROTECTED", message: "The stop is already at or beyond breakeven" } };
  return { stop: be };
}

/**
 * ATR trailing: the stop follows the price at `mult × atr`, only ever toward the price, and only after the
 * trade is `activateAtR` in profit (0 = from the start). Returns null when the stop would not move.
 */
export function trailingStop(
  p: Pick<TrackedPosition, "side" | "entryPrice" | "stopLoss" | "initialStop">,
  o: { price: number; atr: number | null | undefined; mult: number; activateAtR?: number; minStep?: number },
): StopDecision | null {
  if (!(o.atr && o.atr > 0)) return { problem: { code: "NO_ATR", message: "No ATR available to trail with" } };
  const dir = dirOf(p.side);
  const risk = p.initialStop ?? p.stopLoss;
  if (o.activateAtR && risk != null) {
    const r1 = Math.abs(p.entryPrice - risk);
    if (r1 > 0 && favourMove(p.side, p.entryPrice, o.price) < o.activateAtR * r1) return null;
  }
  const candidate = o.price - dir * o.mult * o.atr;
  if (p.stopLoss != null && !tightens(p.side, p.stopLoss, candidate)) return null;
  if (p.stopLoss != null && o.minStep && Math.abs(candidate - p.stopLoss) < o.minStep) return null;
  return { stop: candidate };
}

/** A manual stop or target level: on the right side of the price and, for a stop, only tightening unless `allowLoosen`. */
export function manualLevel(
  p: Pick<TrackedPosition, "side" | "stopLoss">,
  price: number,
  level: { stopLoss?: number | null; takeProfit?: number | null },
  o: { allowLoosen?: boolean } = {},
): ManageProblem | null {
  const bad = exitProblem(p.side, price, level.stopLoss, level.takeProfit);
  if (bad) return { code: "BAD_LEVEL", message: bad.message };
  if (level.stopLoss != null && !o.allowLoosen && p.stopLoss != null && !tightens(p.side, p.stopLoss, level.stopLoss))
    return { code: "BAD_LEVEL", message: "Stops only move toward the price" };
  return null;
}

export interface TakeProfitLeg { price: number; fraction: number }

/** A ladder of targets: each on the winning side of `ref`, in order away from it, fractions summing to at most 1. */
export function validateLadder(side: Side, ref: number, legs: TakeProfitLeg[]): ManageProblem | null {
  const dir = dirOf(side);
  let total = 0, last = ref;
  for (const [i, leg] of legs.entries()) {
    if (!(leg.fraction > 0) || !(leg.price > 0)) return { code: "BAD_LEVEL", message: `Target ${i + 1} needs a positive price and size` };
    if ((leg.price - last) * dir <= 0) return { code: "BAD_LEVEL", message: `Target ${i + 1} (${leg.price}) must be beyond ${i ? `target ${i}` : "the price"} ${last}` };
    total += leg.fraction; last = leg.price;
  }
  if (total > 1 + 1e-9) return { code: "BAD_LEVEL", message: "Targets close more than 100% of the position" };
  return null;
}

/** Legs a bar's range reaches (in ladder order), so a fast bar can take two targets at once. */
export function legsHit(side: Side, legs: TakeProfitLeg[], bar: { high: number; low: number }): TakeProfitLeg[] {
  const long = side === "LONG";
  const out: TakeProfitLeg[] = [];
  for (const leg of legs) {
    if (long ? bar.high >= leg.price : bar.low <= leg.price) out.push(leg);
    else break;
  }
  return out;
}
