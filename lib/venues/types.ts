/**
 * Execution venue interface (spec E4 §4.1). The session engine, risk engine and room are identical for
 * every venue; P8a ships `paper`, P8b adds `ccxt`, P9 adds `oanda` / `mt5`.
 */
import type { SessionCloseReason } from "@prisma/client";
import type { MarketRules } from "@/lib/risk/verdict";

export interface VenueFill {
  orderId: string;
  clientOrderId: string;
  price: number;
  qty: number;
  fee: number;
}

export interface OpenIntent {
  sessionId: string;
  clientOrderId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number | null;
  exitPlan: Record<string, unknown>;
}

export interface CloseIntent {
  sessionId: string;
  clientOrderId: string;
  positionId: string;
  reason: SessionCloseReason;
  /** 0 < fraction ≤ 1; default 1 (full close). */
  fraction?: number;
  /** Reference price to fill at (before slippage); defaults to the live price. */
  price?: number;
}

export interface CloseResult {
  fill: VenueFill;
  /** Net P&L of this close (gross − its share of entry fee − exit fee). */
  realizedPnl: number;
  closed: boolean;
}

export interface Venue {
  kind: "paper" | "ccxt";
  /** True only for real money (not paper, not an exchange sandbox). */
  live: boolean;
  /** The venue's symbol for a catalog symbol (paper: identity). */
  symbolFor(symbol: string): string;
  marketRules(symbol: string): Promise<MarketRules | null>;
  /** "native": a stop order rests on the exchange; "software": the monitor watches the price. */
  stopMode(symbol: string): Promise<"native" | "software">;
  openPosition(i: OpenIntent): Promise<{ positionId: string; fill: VenueFill; replayed: boolean; stop?: { mode: "native" | "software"; error?: string } }>;
  /** Null when the position is already closed (idempotent). */
  closePosition(i: CloseIntent): Promise<CloseResult | null>;
  /** Move the stop. Returns a booked exit when the old exchange stop had already fired. */
  setStop(positionId: string, stopLoss: number): Promise<CloseResult | null>;
  /** Book exchange stops that fired since the last check (native-stop venues). */
  syncStops?(sessionId: string): Promise<Array<{ positionId: string; result: CloseResult }>>;
}

export class VenueError extends Error {
  constructor(message: string, public readonly code: "PRICE_UNAVAILABLE" | "INSUFFICIENT_CAPITAL" | "BAD_ORDER" | "UNKNOWN_ORDER" | "HALTED") {
    super(message);
    this.name = "VenueError";
  }
}
