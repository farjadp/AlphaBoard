/**
 * Paper-trading fill engine (pure, no I/O). Isolated margin, market orders only.
 * Fill model (spec D8): live price ± 0.05% adverse slippage, 0.05% taker fee per side on notional.
 */
import { exitProblem, grossPnl as grossPnlOf } from "@/lib/trading/math";

export const FEE_RATE = 0.0005;
export const SLIPPAGE = 0.0005;
export const MAX_LEVERAGE = 20;

export type PaperSide = "LONG" | "SHORT";
export type { ExitReason } from "@/lib/trading/positions";

export interface OpenPositionState {
  side: PaperSide;
  qty: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export type { Bar } from "@/lib/trading/positions";

export class PaperRuleError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "PaperRuleError";
  }
}

/** Market fills always move against the trader. */
export function applySlippage(action: "BUY" | "SELL", price: number): number {
  return action === "BUY" ? price * (1 + SLIPPAGE) : price * (1 - SLIPPAGE);
}

const entryAction = (side: PaperSide) => (side === "LONG" ? "BUY" : "SELL");
const exitAction = (side: PaperSide) => (side === "LONG" ? "SELL" : "BUY");

/** Throws when SL/TP sit on the wrong side of the reference price for this side. */
export function validateExits(side: PaperSide, ref: number, stopLoss?: number | null, takeProfit?: number | null) {
  const problem = exitProblem(side, ref, stopLoss, takeProfit);
  if (problem) throw new PaperRuleError(problem.message, problem.kind);
}

export function openPosition(o: {
  side: PaperSide; margin: number; leverage: number; price: number; cash: number;
  stopLoss?: number | null; takeProfit?: number | null;
}) {
  if (!(o.margin > 0)) throw new PaperRuleError("Margin must be positive", "BAD_SIZE");
  if (!(o.leverage >= 1 && o.leverage <= MAX_LEVERAGE)) throw new PaperRuleError(`Leverage must be 1–${MAX_LEVERAGE}`, "BAD_LEVERAGE");
  const fillPrice = applySlippage(entryAction(o.side), o.price);
  validateExits(o.side, fillPrice, o.stopLoss, o.takeProfit);
  const notional = o.margin * o.leverage;
  const fee = notional * FEE_RATE;
  if (o.margin + fee > o.cash) throw new PaperRuleError("Not enough cash for margin + fee", "INSUFFICIENT_CASH");
  return { fillPrice, qty: notional / fillPrice, notional, fee, slippage: Math.abs(fillPrice - o.price), cashAfter: o.cash - o.margin - fee };
}

const grossPnl = (p: Pick<OpenPositionState, "side" | "qty" | "entryPrice">, price: number) =>
  grossPnlOf({ side: p.side, qty: p.qty, entry: p.entryPrice }, price);

/** Settle a position at `price` (the quote or the triggered level) — slippage is applied here. */
export function closePosition(p: OpenPositionState, price: number, entryFee: number) {
  const exitPrice = applySlippage(exitAction(p.side), price);
  const gross = grossPnl(p, exitPrice);
  const exitFee = exitPrice * p.qty * FEE_RATE;
  return {
    exitPrice,
    grossPnl: gross,
    exitFee,
    slippage: Math.abs(exitPrice - price),
    cashCredit: Math.max(0, p.margin + gross - exitFee),
    realizedPnl: gross - entryFee - exitFee,
  };
}

export { liquidationPrice, scanExit } from "@/lib/trading/positions";

/** Unrealized PnL at a mark price (no slippage), floored at −margin. */
export function markPosition(p: Pick<OpenPositionState, "side" | "qty" | "entryPrice" | "margin">, mark: number): number {
  return Math.max(-p.margin, grossPnl(p, mark));
}

/** Account equity; null when any open position has no mark (never guess a price). */
export function equityOf(cash: number, open: Array<{ margin: number; unrealizedPnl: number | null }>): number | null {
  let eq = cash;
  for (const p of open) {
    if (p.unrealizedPnl == null) return null;
    eq += p.margin + p.unrealizedPnl;
  }
  return eq;
}
