import "server-only";
import { randomBytes } from "node:crypto";
import type { SessionCloseReason, SessionPosition, TradingSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { livePrice, type PriceOf } from "@/lib/paper/account";
import { notify } from "@/lib/notify/notifications";
import type { Telegram } from "@/lib/notify/telegram";
import { fmt, money } from "@/lib/risk/limits";
import { paperVenue } from "@/lib/venues/paper";
import { VenueError, type CloseResult, type Venue } from "@/lib/venues/types";
import { venueForConnection } from "@/lib/venues/registry";
import { post } from "./room";

/** The session's venue: paper, or the ccxt venue of its exchange connection. */
export async function venueFor(session: Pick<TradingSession, "venue" | "connectionId">, priceOf: PriceOf = livePrice): Promise<Venue> {
  if (session.venue !== "exchange") return paperVenue(priceOf);
  if (!session.connectionId) throw new VenueError("Exchange session without a connection", "BAD_ORDER");
  const conn = await prisma.exchangeConnection.findUniqueOrThrow({ where: { id: session.connectionId } });
  if (conn.status === "DELETED") throw new VenueError("The exchange connection was deleted", "BAD_ORDER");
  return venueForConnection(conn);
}

/**
 * Prices a session should act on: the exchange's own ticker for exchange sessions (its quote currency and
 * its fills), the market-data quote for paper. Returns null when unavailable — never a guess.
 */
export async function sessionPriceOf(session: Pick<TradingSession, "venue" | "connectionId">, fallback: PriceOf = livePrice): Promise<PriceOf> {
  if (session.venue !== "exchange") return fallback;
  const venue = await venueFor(session, fallback);
  return async (symbol) => (await venue.marketRules(symbol))?.price ?? null;
}

/** An order whose outcome is unknown halts the session: the ledger can no longer be trusted. */
export const isUnknownOrder = (e: unknown) => e instanceof VenueError && e.code === "UNKNOWN_ORDER";

/**
 * Stop trading now (unknown order outcome, venue mismatch). Positions still open are closed by the
 * monitor's pending-close pass; the owner is told to check the exchange by hand.
 */
export async function haltSession(session: Pick<TradingSession, "id" | "userId" | "name">, reason: "RECONCILE_MISMATCH" | "ERROR", detail: string, telegram?: Telegram | null) {
  const r = await prisma.tradingSession.updateMany({
    where: { id: session.id, status: { in: ["RUNNING", "PAUSED", "AWAITING_EXTENSION", "ENDING"] } },
    data: { status: "HALTED", endReason: reason, endedAt: new Date(), keepOpen: false, nextCycleAt: null, extensionPromptAt: null },
  });
  if (!r.count) return;
  const body = `Trading halted: ${detail} Open positions will be closed; please check the exchange for anything unexpected.`;
  await post(session.id, "SYSTEM", "ALERT", body);
  await notify(session.userId, { type: "session", title: `${session.name}: halted`, body, data: { sessionId: session.id, href: `/sessions/${session.id}` } }, telegram).catch(() => undefined);
}

/** Deterministic client order id: same intent → same id → the venue refuses to fill twice. */
export const orderId = (sessionId: string, tag: string) => `ab-${sessionId.slice(-10)}-${tag}`.slice(0, 36);
export const uniqueTag = (prefix: string) => `${prefix}${randomBytes(4).toString("hex")}`;

const REASON_TEXT: Record<SessionCloseReason, string> = {
  MANUAL: "closed by you", STRATEGIST: "closed by the strategist", STOP_LOSS: "stop-loss hit", TAKE_PROFIT: "take-profit hit",
  LIQUIDATION: "liquidated", LOSS_LIMIT: "session loss limit", KILL: "kill switch", SESSION_END: "session ended",
  MARKET_CLOSE: "closed before the weekly market close",
};

export interface ExitDeps { priceOf?: PriceOf; telegram?: Telegram | null; venue?: Venue }

/**
 * Close (all or part of) a session position, post the fill in the room and notify the owner.
 * Returns null when it was already closed. Throws VenueError when no price is available.
 */
export async function exitPosition(
  session: Pick<TradingSession, "id" | "userId" | "name" | "venue" | "connectionId">,
  pos: Pick<SessionPosition, "id" | "symbol" | "side">,
  reason: SessionCloseReason,
  opts: ExitDeps & { fraction?: number; price?: number; tag?: string; cycle?: number } = {},
) {
  const venue = opts.venue ?? (await venueFor(session, opts.priceOf));
  const partial = opts.fraction != null && opts.fraction < 1;
  const tag = opts.tag ?? (partial ? uniqueTag("p") : `x-${pos.id.slice(-8)}`);
  let r;
  try {
    r = await venue.closePosition({ sessionId: session.id, clientOrderId: orderId(session.id, tag), positionId: pos.id, reason, fraction: opts.fraction, price: opts.price });
  } catch (e) {
    if (isUnknownOrder(e)) await haltSession(session, "RECONCILE_MISMATCH", (e as Error).message, opts.telegram);
    throw e;
  }
  if (!r) return null;
  await announceExit(session, pos, reason, r, { fraction: opts.fraction, cycle: opts.cycle, telegram: opts.telegram });
  return r;
}

/** Room message + notification for a booked exit (a market close or an exchange stop that fired). */
export async function announceExit(
  session: Pick<TradingSession, "id" | "userId" | "name">,
  pos: Pick<SessionPosition, "id" | "symbol" | "side">,
  reason: SessionCloseReason,
  r: CloseResult,
  opts: { fraction?: number; cycle?: number; telegram?: Telegram | null; onExchange?: boolean } = {},
) {
  const partial = opts.fraction != null && opts.fraction < 1 && !r.closed;
  const what = partial ? `Closed ${Math.round((opts.fraction ?? 1) * 100)}% of` : "Closed";
  const how = opts.onExchange ? "stop-loss order filled on the exchange" : REASON_TEXT[reason];
  const body = `${what} ${pos.side} ${pos.symbol} at ${fmt(r.fill.price)} (${how}) · net ${r.realizedPnl >= 0 ? "+" : "−"}${money(Math.abs(r.realizedPnl))}`;
  await post(session.id, "EXECUTOR", "FILL", body, { positionId: pos.id, reason, price: r.fill.price, qty: r.fill.qty, fee: r.fill.fee, realizedPnl: r.realizedPnl, closed: r.closed }, { cycle: opts.cycle });
  await notify(session.userId, { type: "session", title: `${session.name}: ${pos.symbol} ${partial ? "partly closed" : "closed"}`, body, data: { sessionId: session.id, href: `/sessions/${session.id}` } }, opts.telegram)
    .catch(() => undefined);
}

/** Close every open position of a session. Positions without a price stay open and are retried by the monitor. */
export async function flatten(session: Pick<TradingSession, "id" | "userId" | "name" | "venue" | "connectionId">, reason: SessionCloseReason, deps: ExitDeps = {}) {
  const open = await prisma.sessionPosition.findMany({ where: { sessionId: session.id, closedAt: null } });
  const failed: string[] = [];
  for (const p of open) {
    try {
      await exitPosition(session, p, reason, deps);
    } catch (e) {
      failed.push(`${p.symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed.length) await post(session.id, "SYSTEM", "ALERT", `Could not close ${failed.join("; ")} — retrying every 15 s.`);
  return { closed: open.length - failed.length, failed };
}
