import "server-only";
import { randomBytes } from "node:crypto";
import type { SessionCloseReason, SessionPosition, TradingSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { livePrice, type PriceOf } from "@/lib/paper/account";
import { notify } from "@/lib/notify/notifications";
import type { Telegram } from "@/lib/notify/telegram";
import { fmt, money } from "@/lib/risk/limits";
import { paperVenue } from "@/lib/venues/paper";
import type { Venue } from "@/lib/venues/types";
import { post } from "./room";

export function venueFor(_session: Pick<TradingSession, "venue">, priceOf: PriceOf = livePrice): Venue {
  return paperVenue(priceOf);
}

/** Deterministic client order id: same intent → same id → the venue refuses to fill twice. */
export const orderId = (sessionId: string, tag: string) => `ab-${sessionId.slice(-10)}-${tag}`.slice(0, 36);
export const uniqueTag = (prefix: string) => `${prefix}${randomBytes(4).toString("hex")}`;

const REASON_TEXT: Record<SessionCloseReason, string> = {
  MANUAL: "closed by you", STRATEGIST: "closed by the strategist", STOP_LOSS: "stop-loss hit", TAKE_PROFIT: "take-profit hit",
  LIQUIDATION: "liquidated", LOSS_LIMIT: "session loss limit", KILL: "kill switch", SESSION_END: "session ended",
};

export interface ExitDeps { priceOf?: PriceOf; telegram?: Telegram | null; venue?: Venue }

/**
 * Close (all or part of) a session position, post the fill in the room and notify the owner.
 * Returns null when it was already closed. Throws VenueError when no price is available.
 */
export async function exitPosition(
  session: Pick<TradingSession, "id" | "userId" | "name" | "venue">,
  pos: Pick<SessionPosition, "id" | "symbol" | "side">,
  reason: SessionCloseReason,
  opts: ExitDeps & { fraction?: number; price?: number; tag?: string; cycle?: number } = {},
) {
  const venue = opts.venue ?? venueFor(session, opts.priceOf);
  const partial = opts.fraction != null && opts.fraction < 1;
  const tag = opts.tag ?? (partial ? uniqueTag("p") : `x-${pos.id.slice(-8)}`);
  const r = await venue.closePosition({ sessionId: session.id, clientOrderId: orderId(session.id, tag), positionId: pos.id, reason, fraction: opts.fraction, price: opts.price });
  if (!r) return null;
  const what = partial ? `Closed ${Math.round((opts.fraction ?? 1) * 100)}% of` : "Closed";
  const body = `${what} ${pos.side} ${pos.symbol} at ${fmt(r.fill.price)} (${REASON_TEXT[reason]}) · net ${r.realizedPnl >= 0 ? "+" : "−"}${money(Math.abs(r.realizedPnl))}`;
  await post(session.id, "EXECUTOR", "FILL", body, { positionId: pos.id, reason, price: r.fill.price, qty: r.fill.qty, fee: r.fill.fee, realizedPnl: r.realizedPnl, closed: r.closed }, { cycle: opts.cycle });
  await notify(session.userId, { type: "session", title: `${session.name}: ${pos.symbol} ${partial ? "partly closed" : "closed"}`, body, data: { sessionId: session.id, href: `/sessions/${session.id}` } }, opts.telegram)
    .catch(() => undefined);
  return r;
}

/** Close every open position of a session. Positions without a price stay open and are retried by the monitor. */
export async function flatten(session: Pick<TradingSession, "id" | "userId" | "name" | "venue">, reason: SessionCloseReason, deps: ExitDeps = {}) {
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
