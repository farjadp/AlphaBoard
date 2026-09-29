import "server-only";
import type { TradingSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import type { Telegram } from "@/lib/notify/telegram";
import { exchangeFor, exchangeSymbol } from "@/lib/venues/ccxtClient";
import { haltSession } from "@/lib/sessions/exits";
import { venueForConnection } from "@/lib/venues/registry";

export const RECONCILE_EVERY_MS = 30_000;
/** Balance / position tolerance: one amount step plus this share of the expected size. */
const TOLERANCE = 0.005;
const PENDING_GRACE_MS = 60_000;

export interface ReconcileResult { checked: boolean; issues: string[] }

/**
 * Compare the exchange with the session ledger (spec §4.5). The exchange is the source of truth:
 * - our own orders left open (sessions only send market orders) are cancelled and reported;
 * - PENDING / UNKNOWN orders older than a minute are looked up by client id;
 * - spot: the base balance must cover every open long on this connection;
 * - swap: exchange positions must match ours per symbol.
 * Any issue halts the session; its open positions are then closed by the monitor.
 */
export async function reconcileSession(s: Pick<TradingSession, "id" | "userId" | "name" | "venue" | "connectionId">, opts: { now?: Date; telegram?: Telegram | null } = {}): Promise<ReconcileResult> {
  if (s.venue !== "exchange" || !s.connectionId) return { checked: false, issues: [] };
  const now = opts.now ?? new Date();
  const conn = await prisma.exchangeConnection.findUniqueOrThrow({ where: { id: s.connectionId } });
  if (conn.provider !== "ccxt") {
    // Broker venues (OANDA) reconcile their own way: open trades vs the ledger.
    const venue = await venueForConnection(conn);
    const brokerIssues = (await venue.reconcile?.(s.id)) ?? [];
    await prisma.tradingSession.update({ where: { id: s.id }, data: { lastReconciledAt: now } });
    if (brokerIssues.length) {
      logger.error({ sessionId: s.id, issues: brokerIssues }, "reconcile mismatch");
      await haltSession(s, "RECONCILE_MISMATCH", `the broker does not match the ledger — ${brokerIssues.join("; ")}.`, opts.telegram);
    }
    return { checked: true, issues: brokerIssues };
  }
  const ex = await exchangeFor(conn);
  const markets = await ex.loadMarkets();
  const issues: string[] = [];
  const prefix = `ab-${s.id.slice(-10)}-`;
  const sessionSymbols = [...new Set((await prisma.sessionOrder.findMany({ where: { sessionId: s.id }, select: { symbol: true } })).map((o) => o.symbol))];

  // 1. Our orders must not be resting on the book — except the stop orders the ledger placed.
  const restingStops = new Set((await prisma.sessionOrder.findMany({ where: { sessionId: s.id, purpose: "STOP", status: "OPEN" }, select: { clientOrderId: true } })).map((o) => o.clientOrderId));
  for (const sym of sessionSymbols) {
    const xs = exchangeSymbol(sym, conn.quote, conn.marketType);
    const open = await ex.fetchOpenOrders(xs).catch(() => []);
    for (const o of open.filter((x) => x.clientOrderId?.startsWith(prefix) && !restingStops.has(x.clientOrderId))) {
      await ex.cancelOrder(o.id, xs).catch(() => undefined);
      issues.push(`order ${o.clientOrderId} was still open on ${conn.exchange} and has been cancelled`);
    }
  }

  // 2. Orders whose outcome we never learned.
  const stale = await prisma.sessionOrder.findMany({ where: { sessionId: s.id, status: { in: ["PENDING", "UNKNOWN"] }, createdAt: { lt: new Date(now.getTime() - PENDING_GRACE_MS) } } });
  for (const o of stale) {
    const xs = exchangeSymbol(o.symbol, conn.quote, conn.marketType);
    const lists = await Promise.all([
      ex.fetchOpenOrders(xs).catch(() => []),
      (ex.fetchClosedOrders ? ex.fetchClosedOrders(xs, o.createdAt.getTime() - 60_000) : Promise.resolve([])).catch(() => []),
    ]);
    const hit = lists.flat().find((x) => x.clientOrderId === o.clientOrderId);
    if (!hit || !(hit.filled && hit.filled > 0)) {
      await prisma.sessionOrder.update({ where: { id: o.id }, data: { status: hit ? "CANCELED" : "REJECTED", error: hit ? `found ${hit.status}, not filled` : "not found on the exchange" } });
    } else {
      issues.push(`order ${o.clientOrderId} filled ${hit.filled} on ${conn.exchange} but is not in the ledger`);
    }
  }

  // 3. Holdings / positions.
  const open = await prisma.sessionPosition.findMany({ where: { closedAt: null, session: { connectionId: conn.id } } });
  const bySymbol = new Map<string, { long: number; short: number }>();
  for (const p of open) {
    const cur = bySymbol.get(p.symbol) ?? { long: 0, short: 0 };
    if (p.side === "LONG") cur.long += p.qty; else cur.short += p.qty;
    bySymbol.set(p.symbol, cur);
  }
  if (bySymbol.size) {
    if (conn.marketType === "spot") {
      const bal = await ex.fetchBalance();
      for (const [sym, q] of bySymbol) {
        const m = markets[exchangeSymbol(sym, conn.quote, "spot")];
        if (!m) continue;
        const held = bal.total?.[m.base] ?? 0;
        const step = m.precision.amount && m.precision.amount < 1 ? m.precision.amount : 0;
        if (held + step + q.long * TOLERANCE < q.long) issues.push(`${m.base} balance ${held} is below the ${q.long} the sessions hold`);
      }
    } else if (ex.fetchPositions) {
      const syms = [...bySymbol.keys()].map((x) => exchangeSymbol(x, conn.quote, "swap"));
      const positions = await ex.fetchPositions(syms);
      for (const [sym, q] of bySymbol) {
        const xs = exchangeSymbol(sym, conn.quote, "swap");
        const m = markets[xs];
        const size = (m?.contractSize ?? 1);
        let long = 0, short = 0;
        for (const p of positions.filter((x) => x.symbol === xs)) {
          const base = (p.contracts ?? 0) * (p.contractSize ?? size);
          if (p.side === "short") short += base; else long += base;
        }
        const step = (m?.precision.amount && m.precision.amount < 1 ? m.precision.amount : 0) * size;
        if (Math.abs(long - q.long) > step + q.long * TOLERANCE || Math.abs(short - q.short) > step + q.short * TOLERANCE)
          issues.push(`${xs} exchange position long ${long} / short ${short} ≠ ledger long ${q.long} / short ${q.short}`);
      }
    }
  }

  await prisma.tradingSession.update({ where: { id: s.id }, data: { lastReconciledAt: now } });
  if (issues.length) {
    logger.error({ sessionId: s.id, issues }, "reconcile mismatch");
    await haltSession(s, "RECONCILE_MISMATCH", `the exchange does not match the ledger — ${issues.join("; ")}.`, opts.telegram);
  }
  return { checked: true, issues };
}
