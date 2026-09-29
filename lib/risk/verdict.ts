/**
 * Deterministic risk engine (spec E2/E3): the strategist proposes, this code decides whether and how
 * much. Every rejection or clamp carries a human-readable reason that is posted in the session room.
 * Exits (CLOSE, TIGHTEN_STOP) are never blocked by entry limits.
 */
import { liquidationPrice } from "@/lib/paper/engine";
import type { Mandate } from "@/lib/sessions/mandate";
import { floorToStep, fmt, money } from "./limits";

export type ProposalAction = "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "TIGHTEN_STOP" | "HOLD";

export interface ExitPlan {
  takeProfit: number | null;
  stopLoss: number | null;
  invalidation: string;
  horizonMin: number;
}

export interface Proposal {
  action: ProposalAction;
  symbol: string;
  conviction: number;
  thesis: string;
  exitPlan: ExitPlan;
  positionId: string | null;
}

export interface RiskPosition {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entryPrice: number;
  stopLoss: number | null;
  margin: number;
}

export interface RiskState {
  /** Session equity: capital + realized − fees + unrealized. */
  equity: number;
  /** Capital not tied up as margin. */
  freeCapital: number;
  openPositions: RiskPosition[];
  tradesCount: number;
  /** symbol → epoch ms of the last stop-out on that symbol. */
  lastStopOutAt: Record<string, number>;
  now: number;
  dailyLossUsed: number;
  dailyLossLimit: number | null;
  /** Current session loss as a positive amount (0 when in profit). */
  sessionLoss: number;
}

export interface MarketRules {
  price: number;
  minQty: number;
  minCost: number;
  qtyStep: number;
  feeRate: number;
  slippage: number;
  /** Broker cap on leverage for this instrument (OANDA margin rate); the mandate cap still applies. */
  maxLeverage?: number;
  /** Quote → account currency (conservative side); 1 when the instrument is quoted in the account currency. */
  quoteToAccount?: number;
}

export type Verdict =
  | { kind: "approved" | "clamped"; side: "LONG" | "SHORT"; qty: number; leverage: number; margin: number; stopLoss: number; takeProfit: number | null; reasons: string[] }
  | { kind: "close"; positionId: string; reasons: string[] }
  | { kind: "tighten"; positionId: string; stopLoss: number; reasons: string[] }
  | { kind: "rejected"; reasons: string[] }
  | { kind: "hold"; reasons: string[] };

/** Target must pay the round trip (fees + slippage both ways) with this margin of safety. */
export const FEE_HURDLE = 1.5;

const reject = (...reasons: string[]): Verdict => ({ kind: "rejected", reasons });

function findPosition(p: Proposal, s: RiskState): RiskPosition | undefined {
  if (p.positionId) return s.openPositions.find((x) => x.id === p.positionId);
  return s.openPositions.find((x) => x.symbol === p.symbol);
}

export function evaluateProposal(p: Proposal, m: Mandate, s: RiskState, r: MarketRules | null): Verdict {
  if (p.action === "HOLD") return { kind: "hold", reasons: [] };
  if (!m.symbols.includes(p.symbol)) return reject(`${p.symbol} is not in the session allowlist (${m.symbols.join(", ")})`);

  if (p.action === "CLOSE") {
    const pos = findPosition(p, s);
    return pos ? { kind: "close", positionId: pos.id, reasons: [] } : reject(`no open ${p.symbol} position to close`);
  }

  if (!r || !(r.price > 0)) return reject(`${p.symbol} price unavailable — no trade without a live price`);
  const price = r.price;

  if (p.action === "TIGHTEN_STOP") {
    const pos = findPosition(p, s);
    if (!pos) return reject(`no open ${p.symbol} position to move a stop on`);
    const next = p.exitPlan.stopLoss;
    if (next == null) return reject("tighten needs a new stop level");
    const long = pos.side === "LONG";
    if (long ? next >= price : next <= price) return reject(`new stop ${fmt(next)} must stay ${long ? "below" : "above"} the price ${fmt(price)}`);
    if (pos.stopLoss != null && (long ? next <= pos.stopLoss : next >= pos.stopLoss))
      return reject(`stops only move toward the price (current ${fmt(pos.stopLoss)}, proposed ${fmt(next)})`);
    return { kind: "tighten", positionId: pos.id, stopLoss: next, reasons: [] };
  }

  // Entries.
  const side = p.action === "OPEN_LONG" ? "LONG" : "SHORT";
  const long = side === "LONG";
  if (!long && m.marketType === "spot") return reject("shorts are not possible on a spot session");
  if (s.sessionLoss >= m.lossLimit) return reject(`session loss limit reached (${money(s.sessionLoss)} of ${money(m.lossLimit)})`);
  if (s.dailyLossLimit != null && s.dailyLossUsed >= s.dailyLossLimit)
    return reject(`daily loss limit reached (${money(s.dailyLossUsed)} of ${money(s.dailyLossLimit)})`);
  if (s.tradesCount >= m.maxTrades) return reject(`max trades for this session reached (${s.tradesCount}/${m.maxTrades})`);
  if (s.openPositions.length >= m.maxOpenPositions) return reject(`max open positions reached (${s.openPositions.length}/${m.maxOpenPositions})`);
  if (s.openPositions.some((x) => x.symbol === p.symbol)) return reject(`a ${p.symbol} position is already open`);
  const stoppedAt = s.lastStopOutAt[p.symbol];
  if (stoppedAt != null && s.now - stoppedAt < m.cooldownMin * 60_000) {
    const left = Math.ceil((m.cooldownMin * 60_000 - (s.now - stoppedAt)) / 60_000);
    return reject(`${p.symbol} is in cooldown after a stop-out (${left} min left)`);
  }

  const stop = p.exitPlan.stopLoss;
  if (stop == null || !(stop > 0)) return reject("every entry needs a stop-loss");
  if (long ? stop >= price : stop <= price) return reject(`stop ${fmt(stop)} is on the wrong side of the price ${fmt(price)}`);

  const reasons: string[] = [];
  let tp = p.exitPlan.takeProfit;
  if (tp != null && (long ? tp <= price : tp >= price)) {
    reasons.push(`take-profit ${fmt(tp)} was on the wrong side of the price and was dropped`);
    tp = null;
  }

  const leverage = m.marketType === "spot" ? 1 : Math.max(1, Math.min(m.maxLeverage, r.maxLeverage ?? Infinity));
  if (leverage > 1) {
    const liq = liquidationPrice(side, price, leverage);
    if (long ? stop <= liq : stop >= liq) return reject(`stop ${fmt(stop)} is beyond the ${leverage}x liquidation price ≈ ${fmt(liq)}`);
  }

  const fx = r.quoteToAccount && r.quoteToAccount > 0 ? r.quoteToAccount : 1;
  const riskUsd = s.equity * (m.riskPerTradePct / 100);
  const distance = Math.abs(price - stop);
  // Risk and margin are in the account currency; price distances are in the quote currency.
  const qtyRisk = riskUsd / (distance * fx);
  // Free capital must cover margin + entry fee at the slipped fill price: notional × (1/lev + fee) × (1 + slippage).
  const affordableMargin = s.freeCapital / (1 + leverage * r.feeRate) / (1 + r.slippage);
  const marginCap = Math.max(0, Math.min(affordableMargin, m.capital * (m.maxPositionPct / 100)));
  const qtyCap = (marginCap * leverage) / (price * fx);
  const raw = Math.min(qtyRisk, qtyCap);
  const qty = floorToStep(raw, r.qtyStep);
  const clamped = qtyCap < qtyRisk;
  if (clamped) reasons.push(`size clamped ${fmt(qtyRisk)} → ${fmt(qty)}: position cap ${money(marginCap)} margin × ${leverage}x`);

  if (!(qty > 0) || qty < r.minQty || qty * price < r.minCost)
    return reject(`size ${fmt(qty)} (${money(qty * price)}) is below the venue minimum (${fmt(r.minQty)} / ${money(r.minCost)})`, ...reasons);

  if (tp != null) {
    const gross = Math.abs(tp - price) * qty;
    const roundTrip = 2 * (r.feeRate + r.slippage) * price * qty;
    if (gross < roundTrip * FEE_HURDLE) return reject(`target ${fmt(tp)} is too close: ${money(gross)} potential vs ${money(roundTrip)} fees + slippage`, ...reasons);
  }

  const margin = Number(((qty * price * fx) / leverage).toFixed(8));
  reasons.unshift(`risk ${m.riskPerTradePct}% = ${money(riskUsd)} over a ${fmt(distance)} stop distance${fx !== 1 ? ` (× ${fmt(fx, 4)} into the account currency)` : ""}`);
  return { kind: clamped ? "clamped" : "approved", side, qty, leverage, margin, stopLoss: stop, takeProfit: tp, reasons };
}
