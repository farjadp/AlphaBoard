import "server-only";
import type { ExchangeConnection, SessionPosition } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import type { MarketRules } from "@/lib/risk/verdict";
import { tradingHalted } from "@/lib/exchanges/connections";
import { exchangeFor, exchangeSymbol, type CcxtMarket, type CcxtOrder, type ExchangeLike } from "./ccxtClient";
import { sessionFreeCapital } from "./paper";
import { VenueError, type CloseIntent, type CloseResult, type OpenIntent, type Venue, type VenueFill } from "./types";

type Conn = Pick<ExchangeConnection, "id" | "exchange" | "marketType" | "quote" | "sandbox" | "apiKeyEnc" | "secretEnc" | "passwordEnc" | "uidEnc" | "keyVersion">;

export interface CcxtVenueDeps {
  sleep?: (ms: number) => Promise<void>;
  /** Lookup attempts after an unknown outcome (spec §4.5). */
  lookupTries?: number;
}

/** Errors after which the order may or may not exist on the exchange. */
const UNKNOWN_OUTCOME = new Set(["RequestTimeout", "NetworkError", "ExchangeNotAvailable", "DDoSProtection", "OnMaintenance"]);
const isUnknownOutcome = (e: unknown) => e instanceof Error && (UNKNOWN_OUTCOME.has(e.name) || UNKNOWN_OUTCOME.has(Object.getPrototypeOf(e)?.constructor?.name));

const DEFAULT_TAKER = 0.001;
const EST_SLIPPAGE = 0.001;

function stepOf(m: CcxtMarket) {
  const p = m.precision.amount;
  // TICK_SIZE mode gives the step itself; DECIMAL_PLACES gives a digit count.
  if (p == null) return 1e-8;
  return p >= 1 && Number.isInteger(p) && p < 20 && p !== 1 ? 10 ** -p : p;
}

/** Fee of a fill in quote currency, and the part paid in the base asset (it reduces what a spot buy holds). */
export function feeOf(o: CcxtOrder, m: CcxtMarket, avg: number, filledBase: number) {
  const fees = o.fees?.length ? o.fees : o.fee ? [o.fee] : [];
  let quote = 0;
  let base = 0;
  let unknown = false;
  for (const f of fees) {
    if (!f?.cost) continue;
    if (f.currency === m.quote) quote += f.cost;
    else if (f.currency === m.base) { base += f.cost; quote += f.cost * avg; }
    else unknown = true;
  }
  if (unknown || !fees.length) quote = Math.max(quote, filledBase * avg * (m.taker ?? DEFAULT_TAKER));
  return { quote, base };
}

/**
 * Live / testnet venue over ccxt (spec E5 §4.5). Market orders only. Intent row first (PENDING) with a
 * deterministic clientOrderId; an unknown outcome is resolved by looking the order up — never by a blind
 * retry. The session ledger (positions, fees, P&L) is kept exactly like the paper venue's.
 */
export function ccxtVenue(conn: Conn, deps: CcxtVenueDeps = {}): Venue {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const tries = deps.lookupTries ?? 3;
  const swap = conn.marketType === "swap";
  const sym = (s: string) => exchangeSymbol(s, conn.quote, conn.marketType);

  async function ctx(symbol: string) {
    const ex = await exchangeFor(conn);
    const markets = await ex.loadMarkets();
    const m = markets[sym(symbol)];
    if (!m || m.active === false) throw new VenueError(`${sym(symbol)} is not traded on ${conn.exchange}`, "BAD_ORDER");
    return { ex, m, contract: swap ? m.contractSize ?? 1 : 1 };
  }

  async function lookup(ex: ExchangeLike, s: string, clientOrderId: string): Promise<CcxtOrder | null> {
    for (let i = 0; i < tries; i++) {
      try {
        const since = Date.now() - 60 * 60_000;
        const lists = await Promise.all([
          ex.fetchOpenOrders(s).catch(() => [] as CcxtOrder[]),
          (ex.fetchClosedOrders ? ex.fetchClosedOrders(s, since) : ex.fetchOrders ? ex.fetchOrders(s, since) : Promise.resolve([] as CcxtOrder[])).catch(() => [] as CcxtOrder[]),
        ]);
        const hit = lists.flat().find((o) => o.clientOrderId === clientOrderId);
        if (hit) return hit;
      } catch (e) {
        logger.warn({ clientOrderId, err: e instanceof Error ? e.message : String(e) }, "order lookup failed");
      }
      if (i < tries - 1) await sleep(2_000);
    }
    return null;
  }

  /** Send a market order and wait for its final state. Returns the settled order. */
  async function execute(orderRowId: string, ex: ExchangeLike, s: string, side: "buy" | "sell", amount: number, clientOrderId: string, extra: Record<string, unknown>) {
    let order: CcxtOrder | null = null;
    try {
      order = await ex.createOrder(s, "market", side, amount, undefined, { clientOrderId, ...extra });
    } catch (e) {
      if (!isUnknownOutcome(e)) {
        const msg = e instanceof Error ? e.message.slice(0, 300) : String(e);
        await prisma.sessionOrder.update({ where: { id: orderRowId }, data: { status: "REJECTED", error: msg } });
        throw new VenueError(`${conn.exchange} rejected the order: ${msg}`, "BAD_ORDER");
      }
      await prisma.sessionOrder.update({ where: { id: orderRowId }, data: { status: "UNKNOWN", error: `${(e as Error).name}: looking the order up` } });
      order = await lookup(ex, s, clientOrderId);
      if (!order) throw new VenueError(`Order ${clientOrderId} outcome unknown after ${tries} lookups — halting for safety`, "UNKNOWN_ORDER");
    }
    for (let i = 0; i < 5 && order.status !== "closed" && order.status !== "canceled" && order.status !== "rejected" && order.status !== "expired"; i++) {
      await sleep(1_000);
      order = await ex.fetchOrder(order.id, s).catch(() => order!);
    }
    return order;
  }

  function fillOf(o: CcxtOrder, contract: number): { filledBase: number; avg: number } {
    const filled = (o.filled ?? 0) * contract;
    const avg = o.average ?? (o.cost && o.filled ? o.cost / (o.filled * contract) : o.price ?? 0);
    return { filledBase: filled, avg };
  }

  const venue: Venue = {
    kind: "ccxt",
    live: !conn.sandbox,
    symbolFor: sym,

    async marketRules(symbol: string): Promise<MarketRules | null> {
      try {
        const { ex, m, contract } = await ctx(symbol);
        const t = await ex.fetchTicker(m.symbol);
        const price = t.last ?? (t.bid && t.ask ? (t.bid + t.ask) / 2 : null);
        if (!price || !(price > 0)) return null;
        const step = stepOf(m) * contract;
        return { price, minQty: (m.limits.amount?.min ?? stepOf(m)) * contract, qtyStep: step, minCost: m.limits.cost?.min ?? 0, feeRate: m.taker ?? DEFAULT_TAKER, slippage: EST_SLIPPAGE };
      } catch (e) {
        logger.warn({ exchange: conn.exchange, symbol, err: e instanceof Error ? e.message : String(e) }, "market rules unavailable");
        return null;
      }
    },

    async stopMode(symbol: string) {
      try {
        const { ex } = await ctx(symbol);
        return nativeStops(ex) ? "native" : "software";
      } catch {
        return "software";
      }
    },

    async openPosition(i: OpenIntent) {
      if (tradingHalted()) throw new VenueError("TRADING_HALT is set — no new entries", "HALTED");
      const prior = await prisma.sessionOrder.findUnique({ where: { clientOrderId: i.clientOrderId } });
      if (prior?.positionId && prior.status === "FILLED") {
        return { positionId: prior.positionId, replayed: true, fill: { orderId: prior.id, clientOrderId: prior.clientOrderId, price: prior.avgPrice ?? 0, qty: prior.filled, fee: prior.fee ?? 0 } };
      }
      if (prior) throw new VenueError(`Order ${i.clientOrderId} already attempted (${prior.status}) — not sent again`, "UNKNOWN_ORDER");
      if (!swap && i.side === "SHORT") throw new VenueError("Shorts need a swap connection", "BAD_ORDER");
      const { ex, m, contract } = await ctx(i.symbol);
      const amount = Number(ex.amountToPrecision(m.symbol, i.qty / contract));
      if (!(amount > 0)) throw new VenueError(`Size ${i.qty} rounds to zero on ${conn.exchange}`, "BAD_ORDER");

      const free = await sessionFreeCapital(i.sessionId);
      const row = await prisma.sessionOrder.create({
        data: { sessionId: i.sessionId, clientOrderId: i.clientOrderId, symbol: i.symbol, side: i.side === "LONG" ? "BUY" : "SELL", type: "market", purpose: "ENTRY", amount: amount * contract, status: "PENDING" },
      });
      if (swap) {
        await ex.setMarginMode?.("isolated", m.symbol).catch(() => undefined);
        await ex.setLeverage?.(i.leverage, m.symbol).catch((e) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "setLeverage failed"));
      }
      const order = await execute(row.id, ex, m.symbol, i.side === "LONG" ? "buy" : "sell", amount, i.clientOrderId, {});
      const { filledBase, avg } = fillOf(order, contract);
      if (!(filledBase > 0) || !(avg > 0)) {
        await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: order.status === "canceled" ? "CANCELED" : "REJECTED", venueOrderId: order.id, error: `not filled (${order.status})` } });
        throw new VenueError(`Order not filled (${order.status ?? "unknown"})`, "BAD_ORDER");
      }
      const fee = feeOf(order, m, avg, filledBase);
      const held = !swap && i.side === "LONG" ? filledBase - fee.base : filledBase;
      const margin = (filledBase * avg) / i.leverage;
      if (margin + fee.quote > free * 1.02) logger.warn({ sessionId: i.sessionId, margin, free }, "fill exceeded the session budget");

      const opened = await prisma.$transaction(async (tx) => {
        const pos = await tx.sessionPosition.create({
          data: { sessionId: i.sessionId, symbol: i.symbol, side: i.side, qty: held, entryPrice: avg, leverage: i.leverage, margin, stopLoss: i.stopLoss, takeProfit: i.takeProfit, exitPlan: i.exitPlan as object, fees: fee.quote },
        });
        await tx.sessionOrder.update({
          where: { id: row.id },
          data: { positionId: pos.id, venueOrderId: order.id, status: order.status === "closed" ? "FILLED" : "PARTIAL", filled: held, avgPrice: avg, fee: fee.quote, price: avg },
        });
        await tx.tradingSession.update({ where: { id: i.sessionId }, data: { fees: { increment: fee.quote }, tradesCount: { increment: 1 } } });
        return pos;
      });
      const fill: VenueFill = { orderId: row.id, clientOrderId: i.clientOrderId, price: avg, qty: held, fee: fee.quote };
      // Protect the position on the exchange itself when the venue supports it.
      const stop = nativeStops(ex) ? await placeStop(opened, i.stopLoss, ex, m, contract) : { mode: "software" as const };
      return { positionId: opened.id, replayed: false, fill, stop };
    },

    async closePosition(i: CloseIntent) {
      const pos = await prisma.sessionPosition.findFirst({ where: { id: i.positionId, sessionId: i.sessionId } });
      if (!pos || pos.closedAt) return null;
      if (await prisma.sessionOrder.findUnique({ where: { clientOrderId: i.clientOrderId }, select: { id: true } })) return null;
      const fraction = Math.min(1, Math.max(0, i.fraction ?? 1));
      const { ex, m, contract } = await ctx(pos.symbol);

      // A resting exchange stop goes first: it locks the balance, and it may already have fired.
      const stopRow = await openStop(pos.id);
      if (stopRow) {
        const c = await cancelStop(stopRow, ex, m.symbol);
        if (c.filled) return bookExit(pos, stopRow.id, c.filled, "STOP_LOSS", 1, m, contract);
      }

      let qty = fraction >= 1 - 1e-9 ? pos.qty : pos.qty * fraction;
      if (!swap && pos.side === "LONG") {
        // Never sell more than is actually held (fees in base, dust).
        const bal = await ex.fetchBalance().catch(() => null);
        const freeBase = bal?.free?.[m.base];
        if (freeBase != null) qty = Math.min(qty, freeBase);
      }
      const amount = Number(ex.amountToPrecision(m.symbol, qty / contract));
      if (!(amount > 0)) throw new VenueError(`Nothing to sell: ${pos.symbol} quantity rounds to zero`, "BAD_ORDER");
      const purpose = i.reason === "STOP_LOSS" || i.reason === "LIQUIDATION" ? "STOP" : i.reason === "TAKE_PROFIT" ? "TAKE_PROFIT" : "EXIT";
      const exitSide = pos.side === "LONG" ? "sell" : "buy";
      const row = await prisma.sessionOrder.create({
        data: { sessionId: i.sessionId, positionId: pos.id, clientOrderId: i.clientOrderId, symbol: pos.symbol, side: exitSide === "sell" ? "SELL" : "BUY", type: "market", purpose, reduceOnly: true, amount: amount * contract, status: "PENDING" },
      });
      let order: CcxtOrder;
      try {
        order = await execute(row.id, ex, m.symbol, exitSide, amount, i.clientOrderId, swap ? { reduceOnly: true } : {});
      } catch (e) {
        // The close failed: put the protection back before giving up.
        if (stopRow && pos.stopLoss != null) await placeStop(pos, pos.stopLoss, ex, m, contract).catch(() => undefined);
        throw e;
      }
      const { filledBase, avg } = fillOf(order, contract);
      if (!(filledBase > 0) || !(avg > 0)) {
        await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "REJECTED", venueOrderId: order.id, error: `not filled (${order.status})` } });
        if (stopRow && pos.stopLoss != null) await placeStop(pos, pos.stopLoss, ex, m, contract).catch(() => undefined);
        throw new VenueError(`Close not filled (${order.status ?? "unknown"})`, "BAD_ORDER");
      }
      const r = await bookExit(pos, row.id, order, i.reason, fraction, m, contract);
      if (!r.closed && stopRow && pos.stopLoss != null) {
        const rest = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: pos.id } });
        await placeStop(rest, pos.stopLoss, ex, m, contract);
      }
      return r;
    },

    async setStop(positionId: string, stopLoss: number) {
      const pos = await prisma.sessionPosition.findUnique({ where: { id: positionId } });
      if (!pos || pos.closedAt) return null;
      await prisma.sessionPosition.updateMany({ where: { id: positionId, closedAt: null }, data: { stopLoss } });
      const { ex, m, contract } = await ctx(pos.symbol);
      if (!nativeStops(ex)) return null;
      const row = await openStop(pos.id);
      if (row) {
        const c = await cancelStop(row, ex, m.symbol);
        if (c.filled) return bookExit(pos, row.id, c.filled, "STOP_LOSS", 1, m, contract);
      }
      const r = await placeStop(pos, stopLoss, ex, m, contract);
      if (r.mode !== "native") logger.warn({ positionId, err: r.error }, "native stop not re-placed; software stop protects the position");
      return null;
    },

    async syncStops(sessionId: string) {
      const rows = await prisma.sessionOrder.findMany({ where: { sessionId, purpose: "STOP", status: "OPEN", position: { closedAt: null } }, include: { position: true } });
      const booked: Array<{ positionId: string; result: CloseResult }> = [];
      for (const row of rows) {
        const pos = row.position!;
        try {
          const { ex, m, contract } = await ctx(pos.symbol);
          const o = await ex.fetchOrder(row.venueOrderId ?? "", m.symbol);
          if ((o.filled ?? 0) > 0 && o.status === "closed") {
            booked.push({ positionId: pos.id, result: await bookExit(pos, row.id, o, "STOP_LOSS", 1, m, contract) });
          } else if (o.status === "canceled" || o.status === "expired" || o.status === "rejected") {
            await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "CANCELED", error: `stop ${o.status} on the exchange` } });
            if (pos.stopLoss != null) await placeStop(pos, pos.stopLoss, ex, m, contract);
          }
        } catch (e) {
          logger.warn({ positionId: pos.id, err: e instanceof Error ? e.message : String(e) }, "stop sync failed");
        }
      }
      return booked;
    },
  };
  return venue;

  function nativeStops(ex: ExchangeLike) {
    const f = ex.features as { spot?: { createOrder?: { stopLossPrice?: boolean } }; swap?: { linear?: { createOrder?: { stopLossPrice?: boolean } } } } | undefined;
    return !!(swap ? f?.swap?.linear?.createOrder?.stopLossPrice : f?.spot?.createOrder?.stopLossPrice);
  }

  function openStop(positionId: string) {
    return prisma.sessionOrder.findFirst({ where: { positionId, purpose: "STOP", status: "OPEN" }, orderBy: { createdAt: "desc" } });
  }

  /** Rest a reduce-only stop-market order for the whole position on the exchange. */
  async function placeStop(pos: Pick<SessionPosition, "id" | "sessionId" | "symbol" | "side" | "qty">, stopPrice: number, ex: ExchangeLike, m: CcxtMarket, contract: number): Promise<{ mode: "native" | "software"; error?: string }> {
    const amount = Number(ex.amountToPrecision(m.symbol, pos.qty / contract));
    if (!(amount > 0) || amount * contract < (m.limits.amount?.min ?? 0) * contract) return { mode: "software", error: "position below the exchange minimum for a stop order" };
    const n = (await prisma.sessionOrder.count({ where: { positionId: pos.id, purpose: "STOP", type: "stop_market" } })) + 1;
    const clientOrderId = `ab-${pos.sessionId.slice(-10)}-sl-${pos.id.slice(-6)}-${n}`;
    const exitSide = pos.side === "LONG" ? "sell" : "buy";
    const row = await prisma.sessionOrder.create({
      data: { sessionId: pos.sessionId, positionId: pos.id, clientOrderId, symbol: pos.symbol, side: exitSide === "sell" ? "SELL" : "BUY", type: "stop_market", purpose: "STOP", reduceOnly: true, amount: amount * contract, price: stopPrice, status: "PENDING" },
    });
    try {
      let o: CcxtOrder | null;
      try {
        o = await ex.createOrder(m.symbol, "market", exitSide, amount, undefined, { stopLossPrice: stopPrice, clientOrderId, ...(swap ? { reduceOnly: true } : {}) });
      } catch (e) {
        if (!isUnknownOutcome(e)) throw e;
        o = await lookup(ex, m.symbol, clientOrderId);
        if (!o) throw new Error("stop order outcome unknown");
      }
      await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "OPEN", venueOrderId: o.id } });
      return { mode: "native" };
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
      await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "REJECTED", error: msg } });
      logger.warn({ positionId: pos.id, err: msg }, "native stop rejected; software stop remains");
      return { mode: "software", error: msg };
    }
  }

  /** Cancel a resting stop. Returns the order when it had already filled (the caller books it). */
  async function cancelStop(row: { id: string; venueOrderId: string | null }, ex: ExchangeLike, s: string): Promise<{ filled: CcxtOrder | null }> {
    if (!row.venueOrderId) {
      await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "CANCELED" } });
      return { filled: null };
    }
    let cancelError: unknown = null;
    await ex.cancelOrder(row.venueOrderId, s).catch((e) => { cancelError = e; });
    const o = await ex.fetchOrder(row.venueOrderId, s).catch(() => null);
    if (o && (o.filled ?? 0) > 0 && o.status === "closed") return { filled: o };
    if (o?.status === "canceled" || o?.status === "expired" || o?.status === "rejected" || (!cancelError && o?.status !== "open")) {
      await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "CANCELED" } });
      return { filled: null };
    }
    throw new VenueError(`Could not cancel the exchange stop ${row.venueOrderId}: ${cancelError instanceof Error ? cancelError.message : o?.status ?? "unknown"}`, "BAD_ORDER");
  }

  /** Book a filled exit order (market close or triggered exchange stop) into the session ledger. */
  async function bookExit(pos: SessionPosition, rowId: string, order: CcxtOrder, reason: CloseIntent["reason"], fraction: number, m: CcxtMarket, contract: number): Promise<CloseResult> {
    const { filledBase, avg } = fillOf(order, contract);
    const fee = feeOf(order, m, avg, filledBase);
    const sold = Math.min(filledBase, pos.qty);
    const share = sold / pos.qty;
    const marginPart = pos.margin * share;
    const gross = Math.max(-marginPart, (pos.side === "LONG" ? avg - pos.entryPrice : pos.entryPrice - avg) * sold);
    const entry = await prisma.sessionOrder.aggregate({ where: { positionId: pos.id, purpose: "ENTRY" }, _sum: { fee: true, filled: true } });
    const entryFeeShare = (entry._sum.fee ?? 0) * (sold / (entry._sum.filled || pos.qty));
    const net = gross - entryFeeShare - fee.quote;
    const remaining = pos.qty - sold;
    const dust = remaining * avg < Math.max(m.limits.cost?.min ?? 0, 1e-9) || remaining < (m.limits.amount?.min ?? 0) * contract;
    const full = fraction >= 1 - 1e-9 || dust;

    return prisma.$transaction(async (tx) => {
      const changed = full
        ? await tx.sessionPosition.updateMany({
          where: { id: pos.id, closedAt: null, qty: pos.qty },
          data: { closedAt: new Date(), closePrice: avg, realizedPnl: (pos.realizedPnl ?? 0) + net, closeReason: reason, fees: { increment: fee.quote } },
        })
        : await tx.sessionPosition.updateMany({
          where: { id: pos.id, closedAt: null, qty: pos.qty },
          data: { qty: remaining, margin: pos.margin - marginPart, realizedPnl: (pos.realizedPnl ?? 0) + net, fees: { increment: fee.quote } },
        });
      if (changed.count !== 1) logger.error({ positionId: pos.id }, "position changed during a live close — reconciler will check");
      const row = await tx.sessionOrder.update({ where: { id: rowId }, data: { venueOrderId: order.id, status: "FILLED", filled: sold, avgPrice: avg, fee: fee.quote, price: avg } });
      await tx.tradingSession.update({ where: { id: pos.sessionId }, data: { realizedPnl: { increment: gross }, fees: { increment: fee.quote } } });
      return { fill: { orderId: rowId, clientOrderId: row.clientOrderId, price: avg, qty: sold, fee: fee.quote }, realizedPnl: net, closed: full };
    });
  }
}
