/**
 * Paper-trading fill engine (pure, no I/O). Isolated margin, market orders only.
 * Fill model (spec D8): live price ± 0.05% adverse slippage, 0.05% taker fee per side on notional.
 */
export const FEE_RATE = 0.0005;
export const SLIPPAGE = 0.0005;
export const MAX_LEVERAGE = 20;

export type PaperSide = "LONG" | "SHORT";
export type ExitReason = "STOP_LOSS" | "TAKE_PROFIT" | "LIQUIDATION";

export interface OpenPositionState {
  side: PaperSide;
  qty: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface Bar { time: number; open: number; high: number; low: number; close: number }

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
  const long = side === "LONG";
  if (stopLoss != null && (long ? stopLoss >= ref : stopLoss <= ref))
    throw new PaperRuleError(`Stop-loss must be ${long ? "below" : "above"} ${ref}`, "BAD_STOP");
  if (takeProfit != null && (long ? takeProfit <= ref : takeProfit >= ref))
    throw new PaperRuleError(`Take-profit must be ${long ? "above" : "below"} ${ref}`, "BAD_TARGET");
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
  (p.side === "LONG" ? price - p.entryPrice : p.entryPrice - price) * p.qty;

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

/** Price at which the loss equals the margin (maintenance margin ignored). */
export function liquidationPrice(side: PaperSide, entry: number, leverage: number): number {
  return side === "LONG" ? Math.max(0, entry * (1 - 1 / leverage)) : entry * (1 + 1 / leverage);
}

/**
 * First SL / TP / liquidation hit, walking bars in time order from `fromTime` (bars that started
 * earlier are skipped: their extremes may predate the entry). Same-bar SL+TP → the stop (conservative).
 * A stop gapped through at the open fills at the open.
 */
export function scanExit(p: OpenPositionState, bars: Bar[], fromTime: number): { reason: ExitReason; level: number; at: number } | null {
  const long = p.side === "LONG";
  const liq = liquidationPrice(p.side, p.entryPrice, p.leverage);
  // The stop that triggers first on the way against the position.
  const stopIsLiq = p.stopLoss == null || (long ? p.stopLoss <= liq : p.stopLoss >= liq);
  const stop = stopIsLiq ? liq : p.stopLoss!;
  const stopReason: ExitReason = stopIsLiq ? "LIQUIDATION" : "STOP_LOSS";

  for (const b of [...bars].filter((x) => x.time >= fromTime).sort((a, z) => a.time - z.time)) {
    const stopHit = long ? stop > 0 && b.low <= stop : b.high >= stop;
    if (stopHit) {
      const gapped = long ? b.open < stop : b.open > stop;
      return { reason: stopReason, level: gapped ? b.open : stop, at: b.time };
    }
    if (p.takeProfit != null && (long ? b.high >= p.takeProfit : b.low <= p.takeProfit)) {
      return { reason: "TAKE_PROFIT", level: p.takeProfit, at: b.time };
    }
  }
  return null;
}

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
