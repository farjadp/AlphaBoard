/**
 * Deterministic risk engine (spec E2/E3): the strategist proposes, this code decides whether and how
 * much. Every rejection or clamp carries a human-readable reason that is posted in the session room.
 * Exits (CLOSE, TIGHTEN_STOP) are never blocked by entry limits.
 */
import { findAsset } from "@/lib/assetCatalog";
import { minutesToWeeklyClose, tradesWeekdaysOnly } from "@/lib/market/hours";
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
  /** Stop at entry (the exit plan's initialStop) — defines 1R for stop tightening. */
  initialStop?: number | null;
  margin: number;
}

/**
 * Market data the engine needs per symbol (from the cycle's context). Omitted = the caller has no market
 * context (unit tests of the sizing rules); `atr1h: null` = unavailable, and entries are then refused.
 */
export interface SymbolSignals {
  atr1h: number | null;
  /** "Bullish" | "Bearish" | "Neutral"; null/absent when unavailable. */
  trend4h?: string | null;
  /** The market (technical) analyst's note for this symbol this cycle; null = no note; absent = not checked. */
  analyst?: { stance: string; confidence: number } | null;
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
/** An entry's stop must sit at least this many 1H ATRs from the price — tighter stops are noise. */
export const MIN_STOP_ATR = 1.5;
/** A stop may only be tightened after the trade has moved this many R in its favour… */
export const TIGHTEN_AFTER_R = 1;
/** …and the new stop must stay at least this many 1H ATRs from the price. */
export const TIGHTEN_MIN_ATR = 1;
/** No new entries on weekday-only markets this close to the Friday close. */
export const NO_ENTRY_BEFORE_CLOSE_MIN = 60;
/** Entries below this conviction are refused: "the best of the allowed symbols" is not a setup. */
export const MIN_ENTRY_CONVICTION = 0.7;
/** The market analyst must read the symbol in the entry's direction with at least this confidence. */
export const MIN_ANALYST_CONFIDENCE = 0.6;
/** Float tolerance for price-distance comparisons (1.103 − 1.102 is 0.000999…). */
const EPS = 1e-9;

/** Currency legs of an FX / metal pair ("GBP/USD" → GBP, USD); null for anything else. */
function legs(symbol: string): [string, string] | null {
  const a = findAsset(symbol);
  if (!a || (a.category !== "forex" && a.category !== "commodities")) return null;
  const [base, quote] = symbol.split("/");
  return base && quote ? [base, quote] : null;
}

/** +1 long / −1 short exposure per currency for one position. */
function exposure(symbol: string, side: "LONG" | "SHORT"): Array<[string, number]> {
  const l = legs(symbol);
  if (!l) return [];
  const sign = side === "LONG" ? 1 : -1;
  return [[l[0], sign], [l[1], -sign]];
}

const reject = (...reasons: string[]): Verdict => ({ kind: "rejected", reasons });

function findPosition(p: Proposal, s: RiskState): RiskPosition | undefined {
  if (p.positionId) return s.openPositions.find((x) => x.id === p.positionId);
  return s.openPositions.find((x) => x.symbol === p.symbol);
}

export function evaluateProposal(p: Proposal, m: Mandate, s: RiskState, r: MarketRules | null, sig?: SymbolSignals): Verdict {
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
    const initial = pos.initialStop ?? pos.stopLoss;
    if (initial != null) {
      const r1 = Math.abs(pos.entryPrice - initial);
      const progress = long ? price - pos.entryPrice : pos.entryPrice - price;
      if (r1 > 0 && progress < TIGHTEN_AFTER_R * r1 - price * EPS)
        return reject(`stops tighten only after the trade has moved ${TIGHTEN_AFTER_R}R in its favour (now ${(progress / r1).toFixed(2)}R) — an early tight stop gets taken by noise`);
    }
    const atr = sig?.atr1h;
    if (atr != null && atr > 0 && Math.abs(price - next) < TIGHTEN_MIN_ATR * atr - price * EPS)
      return reject(`new stop ${fmt(next)} is closer than ${TIGHTEN_MIN_ATR}× the 1H ATR (${fmt(atr)}) to the price ${fmt(price)}`);
    return { kind: "tighten", positionId: pos.id, stopLoss: next, reasons: [] };
  }

  // Entries.
  const side = p.action === "OPEN_LONG" ? "LONG" : "SHORT";
  const long = side === "LONG";
  if (!long && m.marketType === "spot") return reject("shorts are not possible on a spot session");
  if (!(p.conviction >= MIN_ENTRY_CONVICTION))
    return reject(`conviction ${Math.round(p.conviction * 100)}% is below the ${Math.round(MIN_ENTRY_CONVICTION * 100)}% needed to open — no trade is the default`);
  const t4 = sig?.trend4h?.toLowerCase();
  if (t4 === (long ? "bearish" : "bullish")) return reject(`the 4H trend is ${t4} — no ${side.toLowerCase()} against the higher timeframe`);
  if (sig && sig.analyst !== undefined) {
    const want = long ? "bullish" : "bearish";
    const a = sig.analyst;
    if (!a || a.stance.toLowerCase() !== want || a.confidence < MIN_ANALYST_CONFIDENCE)
      return reject(`the market analyst reads ${p.symbol} as ${a ? `${a.stance} ${Math.round(a.confidence * 100)}%` : "—"} — an entry needs a ${want} read of at least ${Math.round(MIN_ANALYST_CONFIDENCE * 100)}%`);
  }
  if (s.sessionLoss >= m.lossLimit) return reject(`session loss limit reached (${money(s.sessionLoss)} of ${money(m.lossLimit)})`);
  if (s.dailyLossLimit != null && s.dailyLossUsed >= s.dailyLossLimit)
    return reject(`daily loss limit reached (${money(s.dailyLossUsed)} of ${money(s.dailyLossLimit)})`);
  if (s.tradesCount >= m.maxTrades) return reject(`max trades for this session reached (${s.tradesCount}/${m.maxTrades})`);
  if (s.openPositions.length >= m.maxOpenPositions) return reject(`max open positions reached (${s.openPositions.length}/${m.maxOpenPositions})`);
  if (s.openPositions.some((x) => x.symbol === p.symbol)) return reject(`a ${p.symbol} position is already open`);
  if (tradesWeekdaysOnly(p.symbol)) {
    const left = minutesToWeeklyClose(new Date(s.now));
    if (left <= 0) return reject(`${p.symbol} is closed for the weekend (reopens Sunday 17:00 New York)`);
    if (left < NO_ENTRY_BEFORE_CLOSE_MIN) return reject(`${left} min to the weekly close — no new ${p.symbol} entries in the last ${NO_ENTRY_BEFORE_CLOSE_MIN} min`);
  }
  const held = new Map<string, { sign: number; via: string }>();
  for (const x of s.openPositions) for (const [cur, sign] of exposure(x.symbol, x.side)) held.set(cur, { sign, via: x.symbol });
  for (const [cur, sign] of exposure(p.symbol, side)) {
    const h = held.get(cur);
    if (h && h.sign !== sign)
      return reject(`${side.toLowerCase()} ${p.symbol} would be ${sign > 0 ? "long" : "short"} ${cur} while the ${h.via} position is ${h.sign > 0 ? "long" : "short"} ${cur} — the two would cancel out`);
  }
  const stoppedAt = s.lastStopOutAt[p.symbol];
  if (stoppedAt != null && s.now - stoppedAt < m.cooldownMin * 60_000) {
    const left = Math.ceil((m.cooldownMin * 60_000 - (s.now - stoppedAt)) / 60_000);
    return reject(`${p.symbol} is in cooldown after a stop-out (${left} min left)`);
  }

  const stop = p.exitPlan.stopLoss;
  if (stop == null || !(stop > 0)) return reject("every entry needs a stop-loss");
  if (long ? stop >= price : stop <= price) return reject(`stop ${fmt(stop)} is on the wrong side of the price ${fmt(price)}`);
  if (sig) {
    if (sig.atr1h == null || !(sig.atr1h > 0)) return reject(`${p.symbol} 1H ATR unavailable — no entry without a volatility reading`);
    const floor = MIN_STOP_ATR * sig.atr1h;
    if (Math.abs(price - stop) < floor - price * EPS)
      return reject(`stop ${fmt(stop)} is ${fmt(Math.abs(price - stop))} from the price — inside ${MIN_STOP_ATR}× the 1H ATR (min distance ${fmt(floor)}); widen it and the size shrinks to the same risk`);
  }

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
