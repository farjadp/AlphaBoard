import "server-only";
import type { ExchangeConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import type { MarketRules } from "@/lib/risk/verdict";
import { tradingHalted } from "@/lib/exchanges/connections";
import { exchangeFor, exchangeSymbol, type CcxtMarket, type CcxtOrder, type ExchangeLike } from "./ccxtClient";
import { sessionFreeCapital } from "./paper";
import { VenueError, type CloseIntent, type OpenIntent, type Venue, type VenueFill } from "./types";

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

  return {
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

      return prisma.$transaction(async (tx) => {
        const pos = await tx.sessionPosition.create({
          data: { sessionId: i.sessionId, symbol: i.symbol, side: i.side, qty: held, entryPrice: avg, leverage: i.leverage, margin, stopLoss: i.stopLoss, takeProfit: i.takeProfit, exitPlan: i.exitPlan as object, fees: fee.quote },
        });
        await tx.sessionOrder.update({
          where: { id: row.id },
          data: { positionId: pos.id, venueOrderId: order.id, status: order.status === "closed" ? "FILLED" : "PARTIAL", filled: held, avgPrice: avg, fee: fee.quote, price: avg },
        });
        await tx.tradingSession.update({ where: { id: i.sessionId }, data: { fees: { increment: fee.quote }, tradesCount: { increment: 1 } } });
        const fill: VenueFill = { orderId: row.id, clientOrderId: i.clientOrderId, price: avg, qty: held, fee: fee.quote };
        return { positionId: pos.id, replayed: false, fill };
      });
    },

    async closePosition(i: CloseIntent) {
      const pos = await prisma.sessionPosition.findFirst({ where: { id: i.positionId, sessionId: i.sessionId } });
      if (!pos || pos.closedAt) return null;
      if (await prisma.sessionOrder.findUnique({ where: { clientOrderId: i.clientOrderId }, select: { id: true } })) return null;
      const fraction = Math.min(1, Math.max(0, i.fraction ?? 1));
      const { ex, m, contract } = await ctx(pos.symbol);
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
      const order = await execute(row.id, ex, m.symbol, exitSide, amount, i.clientOrderId, swap ? { reduceOnly: true } : {});
      const { filledBase, avg } = fillOf(order, contract);
      if (!(filledBase > 0) || !(avg > 0)) {
        await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "REJECTED", venueOrderId: order.id, error: `not filled (${order.status})` } });
        throw new VenueError(`Close not filled (${order.status ?? "unknown"})`, "BAD_ORDER");
      }
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
            data: { closedAt: new Date(), closePrice: avg, realizedPnl: (pos.realizedPnl ?? 0) + net, closeReason: i.reason, fees: { increment: fee.quote } },
          })
          : await tx.sessionPosition.updateMany({
            where: { id: pos.id, closedAt: null, qty: pos.qty },
            data: { qty: remaining, margin: pos.margin - marginPart, realizedPnl: (pos.realizedPnl ?? 0) + net, fees: { increment: fee.quote } },
          });
        if (changed.count !== 1) logger.error({ positionId: pos.id }, "position changed during a live close — reconciler will check");
        await tx.sessionOrder.update({ where: { id: row.id }, data: { venueOrderId: order.id, status: "FILLED", filled: sold, avgPrice: avg, fee: fee.quote, price: avg } });
        await tx.tradingSession.update({ where: { id: i.sessionId }, data: { realizedPnl: { increment: gross }, fees: { increment: fee.quote } } });
        return { fill: { orderId: row.id, clientOrderId: i.clientOrderId, price: avg, qty: sold, fee: fee.quote }, realizedPnl: net, closed: full };
      });
    },

    async setStop(positionId: string, stopLoss: number) {
      await prisma.sessionPosition.updateMany({ where: { id: positionId, closedAt: null }, data: { stopLoss } });
    },
  };
}
