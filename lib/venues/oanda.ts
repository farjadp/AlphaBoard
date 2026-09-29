import "server-only";
import type { ExchangeConnection, SessionPosition } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import type { MarketRules } from "@/lib/risk/verdict";
import { tradingHalted } from "@/lib/exchanges/connections";
import { decryptSecret } from "@/lib/secrets/crypto";
import { sessionFreeCapital } from "./paper";
import { VenueError, type CloseIntent, type CloseResult, type OpenIntent, type Venue, type VenueFill } from "./types";

/**
 * OANDA v20 REST venue (P9): forex and metals as margin CFDs, long or short. Each session position is one
 * OANDA trade (`venueTradeId`). Orders are FOK market orders carrying our clientOrderId as the order's and
 * the trade's client extension id, so an unknown outcome is resolved with `…/trades/@<clientId>` — never
 * by sending again. The stop-loss rides on the trade (`stopLossOnFill`), so it lives at the broker.
 * P&L, fees and financing come from OANDA's transactions, in the account currency.
 */

type Conn = Pick<ExchangeConnection, "id" | "sandbox" | "apiKeyEnc" | "accountId" | "quote">;
export type OandaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface OandaDeps {
  fetch?: OandaFetch;
  sleep?: (ms: number) => Promise<void>;
  lookupTries?: number;
}

export const OANDA_HOSTS = { practice: "https://api-fxpractice.oanda.com", live: "https://api-fxtrade.oanda.com" } as const;

/** Catalog symbol → OANDA instrument. */
const SPECIAL: Record<string, string> = { WTI: "WTICO_USD", BRENT: "BCO_USD", NG: "NATGAS_USD", COPPER: "XCU_USD" };
export function oandaInstrument(symbol: string): string {
  return SPECIAL[symbol] ?? symbol.replace("/", "_");
}

interface Instrument { name: string; type: string; displayPrecision: number; tradeUnitsPrecision: number; minimumTradeSize: string; marginRate: string }
interface OandaTrade {
  id: string; instrument: string; price: string; currentUnits: string; initialUnits: string; state: "OPEN" | "CLOSED" | "CLOSE_WHEN_TRADEABLE";
  realizedPL?: string; averageClosePrice?: string; financing?: string; closeTime?: string;
  clientExtensions?: { id?: string }; stopLossOrder?: { id: string; price: string; state: string };
}

export class OandaError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = status === 0 ? "NetworkError" : "OandaError";
  }
}

const num = (v: unknown) => (typeof v === "string" || typeof v === "number" ? Number(v) : NaN);
/** Stops round away from the market: a long's stop down, a short's up (never tighter than asked). */
export function roundStop(price: number, side: "LONG" | "SHORT", digits: number): string {
  const f = 10 ** digits;
  const v = side === "LONG" ? Math.floor(price * f + 1e-9) / f : Math.ceil(price * f - 1e-9) / f;
  return v.toFixed(digits);
}

const floorUnits = (n: number, precision: number) => {
  const f = 10 ** Math.max(0, precision);
  return Math.floor(Math.abs(n) * f + 1e-9) / f;
};

let defaultFetch: OandaFetch = (url, init) => fetch(url, init);
/** Tests only: route every OANDA call to a fake server. */
export function setOandaFetch(f: OandaFetch | null) {
  defaultFetch = f ?? ((url, init) => fetch(url, init));
}

export function oandaVenue(conn: Conn, deps: OandaDeps = {}): Venue {
  const doFetch = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const tries = deps.lookupTries ?? 3;
  if (!conn.accountId) throw new VenueError("OANDA connection without an account id", "BAD_ORDER");
  const base = `${conn.sandbox ? OANDA_HOSTS.practice : OANDA_HOSTS.live}/v3/accounts/${encodeURIComponent(conn.accountId)}`;
  let token: string | null = null;
  const instruments = new Map<string, Instrument>();

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    token ??= decryptSecret(conn.apiKeyEnc);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Accept-Datetime-Format": "RFC3339" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new OandaError(`OANDA ${method} ${path.split("?")[0]}: network error (${e instanceof Error ? e.name : "unknown"})`, 0, null);
    }
    const json = (await res.json().catch(() => null)) as (T & { errorMessage?: string; errorCode?: string }) | null;
    if (!res.ok) throw new OandaError(`OANDA ${method} ${path.split("?")[0]}: ${json?.errorMessage ?? `HTTP ${res.status}`}`, res.status, json);
    return json as T;
  }

  async function instrument(symbol: string) {
    const name = oandaInstrument(symbol);
    if (!instruments.has(name)) {
      const r = await call<{ instruments: Instrument[] }>("GET", `/instruments?instruments=${encodeURIComponent(name)}`).catch(() => ({ instruments: [] as Instrument[] }));
      const inst = r.instruments.find((i) => i.name === name);
      if (!inst) throw new VenueError(`${name} is not tradable on this OANDA account`, "BAD_ORDER");
      instruments.set(name, inst);
    }
    return instruments.get(name)!;
  }

  async function price(name: string) {
    const r = await call<{ prices: Array<{ instrument: string; tradeable: boolean; bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }> }>("GET", `/pricing?instruments=${encodeURIComponent(name)}`);
    const p = r.prices.find((x) => x.instrument === name);
    const bid = num(p?.bids?.[0]?.price);
    const ask = num(p?.asks?.[0]?.price);
    if (!p || !(bid > 0) || !(ask > 0)) return null;
    return { bid, ask, mid: (bid + ask) / 2, tradeable: p.tradeable };
  }

  type Tx = { id: string; type: string; clientOrderID?: string; reason?: string; tradeOpened?: { tradeID: string; units: string; price: string } };
  /**
   * After an unknown outcome: the trade by its client id, else the transactions since the cursor taken
   * before sending (OANDA does not dedupe a filled market order, so we must find it, never resend).
   */
  async function tradeByClientId(clientId: string, sinceTx: string | null): Promise<OandaTrade | null> {
    for (let i = 0; i < tries; i++) {
      try {
        return (await call<{ trade: OandaTrade }>("GET", `/trades/@${encodeURIComponent(clientId)}`)).trade;
      } catch (e) {
        if (!(e instanceof OandaError) || e.status !== 404) {
          if (i < tries - 1) await sleep(2_000);
          continue;
        }
      }
      if (sinceTx) {
        const txs = await call<{ transactions: Tx[] }>("GET", `/transactions/sinceid?id=${encodeURIComponent(sinceTx)}`).catch(() => null);
        const mine = txs?.transactions.filter((t) => t.clientOrderID === clientId) ?? [];
        const fill = mine.find((t) => t.type === "ORDER_FILL" && t.tradeOpened);
        if (fill?.tradeOpened) return (await call<{ trade: OandaTrade }>("GET", `/trades/${fill.tradeOpened.tradeID}`)).trade;
        if (mine.some((t) => t.type === "ORDER_CANCEL" || t.type === "MARKET_ORDER_REJECT")) return null;
      }
      if (i < tries - 1) await sleep(2_000);
    }
    throw new VenueError(`Order ${clientId} outcome unknown after ${tries} lookups — halting for safety`, "UNKNOWN_ORDER");
  }

  /** Book a closed (or reduced) OANDA trade into the ledger. */
  async function book(pos: SessionPosition, rowId: string, fill: { price: number; units: number; pl: number; commission: number; financing: number; transactionId: string }, reason: CloseIntent["reason"], full: boolean): Promise<CloseResult> {
    const sold = Math.min(Math.abs(fill.units), pos.qty);
    const share = sold / pos.qty;
    const marginPart = pos.margin * share;
    const exitFee = Math.max(0, fill.commission) + Math.max(0, -fill.financing);
    const gross = fill.pl + Math.max(0, fill.financing);
    const entry = await prisma.sessionOrder.aggregate({ where: { positionId: pos.id, purpose: "ENTRY" }, _sum: { fee: true, filled: true } });
    const entryFeeShare = (entry._sum.fee ?? 0) * (sold / (entry._sum.filled || pos.qty));
    const net = gross - entryFeeShare - exitFee;
    const closed = full || pos.qty - sold <= 1e-9;
    return prisma.$transaction(async (tx) => {
      const changed = closed
        ? await tx.sessionPosition.updateMany({
          where: { id: pos.id, closedAt: null, qty: pos.qty },
          data: { closedAt: new Date(), closePrice: fill.price, realizedPnl: (pos.realizedPnl ?? 0) + net, closeReason: reason, fees: { increment: exitFee } },
        })
        : await tx.sessionPosition.updateMany({
          where: { id: pos.id, closedAt: null, qty: pos.qty },
          data: { qty: pos.qty - sold, margin: pos.margin - marginPart, realizedPnl: (pos.realizedPnl ?? 0) + net, fees: { increment: exitFee } },
        });
      if (changed.count !== 1) logger.error({ positionId: pos.id }, "position changed during an OANDA close — reconciler will check");
      const row = await tx.sessionOrder.update({ where: { id: rowId }, data: { venueOrderId: fill.transactionId, status: "FILLED", filled: sold, avgPrice: fill.price, fee: exitFee, price: fill.price } });
      if (closed) await tx.sessionOrder.updateMany({ where: { positionId: pos.id, purpose: "STOP", status: "OPEN", id: { not: rowId } }, data: { status: reason === "STOP_LOSS" ? "FILLED" : "CANCELED" } });
      await tx.tradingSession.update({ where: { id: pos.sessionId }, data: { realizedPnl: { increment: gross }, fees: { increment: exitFee } } });
      return { fill: { orderId: rowId, clientOrderId: row.clientOrderId, price: fill.price, qty: sold, fee: exitFee }, realizedPnl: net, closed };
    });
  }

  const venue: Venue = {
    kind: "oanda",
    live: !conn.sandbox,
    categories: ["forex", "commodities"],
    symbolFor: oandaInstrument,
    stopMode: async () => "native",

    async balance() {
      const r = await call<{ account: { marginAvailable: string; currency: string } }>("GET", "/summary");
      return { free: num(r.account.marginAvailable), currency: r.account.currency };
    },

    async marketRules(symbol: string): Promise<MarketRules | null> {
      try {
        const inst = await instrument(symbol);
        // P&L is booked in the account currency: only instruments quoted in it (XAU_USD on a USD account).
        if (!inst.name.endsWith(`_${conn.quote}`)) return null;
        const p = await price(inst.name);
        if (!p || !p.tradeable) return null;
        const step = 10 ** -inst.tradeUnitsPrecision;
        const marginRate = num(inst.marginRate);
        return {
          price: p.mid, minQty: Math.max(num(inst.minimumTradeSize) || step, step), qtyStep: step, minCost: 0,
          feeRate: 0, slippage: (p.ask - p.bid) / p.mid / 2, maxLeverage: marginRate > 0 ? Math.floor(1 / marginRate) : undefined,
        };
      } catch (e) {
        logger.warn({ symbol, err: e instanceof Error ? e.message : String(e) }, "OANDA market rules unavailable");
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
      const inst = await instrument(i.symbol);
      const units = floorUnits(i.qty, inst.tradeUnitsPrecision);
      if (!(units > 0)) throw new VenueError(`Size ${i.qty} rounds to zero units on OANDA`, "BAD_ORDER");
      const free = await sessionFreeCapital(i.sessionId);
      const cursor = (await call<{ lastTransactionID: string }>("GET", "/summary").catch(() => null))?.lastTransactionID ?? null;
      const row = await prisma.sessionOrder.create({
        data: { sessionId: i.sessionId, clientOrderId: i.clientOrderId, symbol: i.symbol, side: i.side === "LONG" ? "BUY" : "SELL", type: "market", purpose: "ENTRY", amount: units, status: "PENDING" },
      });
      const signed = i.side === "LONG" ? units : -units;
      const order = {
        type: "MARKET", instrument: inst.name, units: String(signed), timeInForce: "FOK",
        // Never net against another trade on the same account (another session, a manual trade).
        positionFill: "OPEN_ONLY",
        clientExtensions: { id: i.clientOrderId, tag: "alphaboard" }, tradeClientExtensions: { id: i.clientOrderId, tag: "alphaboard" },
        stopLossOnFill: { price: roundStop(i.stopLoss, i.side, inst.displayPrecision), timeInForce: "GTC" },
      };
      type Fill = { id: string; price: string; tradeOpened?: { tradeID: string; units: string; price: string }; commission?: string; financing?: string };
      let fillPrice: number, fillUnits: number, tradeId: string, fillId: string, commission = 0;
      try {
        const r = await call<{ orderFillTransaction?: Fill; orderCancelTransaction?: { reason: string } }>("POST", "/orders", { order });
        if (!r.orderFillTransaction?.tradeOpened) {
          const reason = r.orderCancelTransaction?.reason ?? "not filled";
          await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "CANCELED", error: reason } });
          throw new VenueError(reason === "MARKET_HALTED" ? `${inst.name}: market closed` : `OANDA did not fill the order (${reason})`, "BAD_ORDER");
        }
        const f = r.orderFillTransaction;
        fillPrice = num(f.tradeOpened!.price);
        fillUnits = Math.abs(num(f.tradeOpened!.units));
        tradeId = f.tradeOpened!.tradeID;
        fillId = f.id;
        commission = Math.max(0, num(f.commission) || 0);
      } catch (e) {
        if (e instanceof VenueError) throw e;
        if (e instanceof OandaError && e.status !== 0 && e.status < 500) {
          const msg = e.message.slice(0, 300);
          await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "REJECTED", error: msg } });
          throw new VenueError(msg, "BAD_ORDER");
        }
        // Network error or 5xx: the order may or may not exist — look it up by client id.
        await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "UNKNOWN", error: `${(e as Error).message}: looking the trade up` } });
        const t = await tradeByClientId(i.clientOrderId, cursor);
        if (!t) {
          await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "CANCELED", error: "not filled" } });
          throw new VenueError("OANDA did not fill the order", "BAD_ORDER");
        }
        fillPrice = num(t.price);
        fillUnits = Math.abs(num(t.initialUnits));
        tradeId = t.id;
        fillId = `trade-${t.id}`;
      }
      const marginRate = num(inst.marginRate) || 1 / i.leverage;
      const margin = fillUnits * fillPrice * marginRate;
      if (margin > free * 1.02) logger.warn({ sessionId: i.sessionId, margin, free }, "OANDA fill exceeded the session budget");
      const pos = await prisma.$transaction(async (tx) => {
        const p = await tx.sessionPosition.create({
          data: {
            sessionId: i.sessionId, symbol: i.symbol, side: i.side, qty: fillUnits, entryPrice: fillPrice, leverage: Math.round(1 / marginRate), margin,
            stopLoss: i.stopLoss, takeProfit: i.takeProfit, exitPlan: i.exitPlan as object, fees: commission, venueTradeId: tradeId,
          },
        });
        await tx.sessionOrder.update({ where: { id: row.id }, data: { positionId: p.id, venueOrderId: fillId, status: "FILLED", filled: fillUnits, avgPrice: fillPrice, fee: commission, price: fillPrice } });
        await tx.sessionOrder.create({
          data: {
            sessionId: i.sessionId, positionId: p.id, clientOrderId: `${i.clientOrderId}-sl`.slice(0, 64), symbol: i.symbol, side: i.side === "LONG" ? "SELL" : "BUY",
            type: "stop_market", purpose: "STOP", reduceOnly: true, amount: fillUnits, price: i.stopLoss, status: "OPEN", venueOrderId: `trade-${tradeId}-sl`,
          },
        });
        await tx.tradingSession.update({ where: { id: i.sessionId }, data: { fees: { increment: commission }, tradesCount: { increment: 1 } } });
        return p;
      });
      const fill: VenueFill = { orderId: row.id, clientOrderId: i.clientOrderId, price: fillPrice, qty: fillUnits, fee: commission };
      return { positionId: pos.id, replayed: false, fill, stop: { mode: "native" as const } };
    },

    async closePosition(i: CloseIntent) {
      const pos = await prisma.sessionPosition.findFirst({ where: { id: i.positionId, sessionId: i.sessionId } });
      if (!pos || pos.closedAt) return null;
      if (await prisma.sessionOrder.findUnique({ where: { clientOrderId: i.clientOrderId }, select: { id: true } })) return null;
      if (!pos.venueTradeId) throw new VenueError("Position has no OANDA trade id", "BAD_ORDER");
      // The broker stop may already have closed it.
      const synced = await syncOne(pos);
      if (synced) return synced;
      const inst = await instrument(pos.symbol);
      const fraction = Math.min(1, Math.max(0, i.fraction ?? 1));
      const full = fraction >= 1 - 1e-9;
      const units = full ? "ALL" : String(floorUnits(pos.qty * fraction, inst.tradeUnitsPrecision));
      if (units !== "ALL" && !(Number(units) > 0)) throw new VenueError("Partial close rounds to zero units", "BAD_ORDER");
      const purpose = i.reason === "STOP_LOSS" || i.reason === "LIQUIDATION" ? "STOP" : i.reason === "TAKE_PROFIT" ? "TAKE_PROFIT" : "EXIT";
      const row = await prisma.sessionOrder.create({
        data: { sessionId: i.sessionId, positionId: pos.id, clientOrderId: i.clientOrderId, symbol: pos.symbol, side: pos.side === "LONG" ? "SELL" : "BUY", type: "market", purpose, reduceOnly: true, amount: units === "ALL" ? pos.qty : Number(units), status: "PENDING" },
      });
      type Closed = { tradeID: string; units: string; price: string; realizedPL?: string; financing?: string };
      type CloseFill = { id: string; units: string; fullVWAP?: string; pl?: string; commission?: string; financing?: string; tradesClosed?: Closed[]; tradeReduced?: Closed };
      try {
        const r = await call<{ orderFillTransaction?: CloseFill; orderCancelTransaction?: { reason: string } }>("PUT", `/trades/${pos.venueTradeId}/close`, { units });
        const f = r.orderFillTransaction;
        if (!f) {
          const reason = r.orderCancelTransaction?.reason ?? "not filled";
          await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "CANCELED", error: reason } });
          throw new VenueError(reason === "MARKET_HALTED" ? `${inst.name}: market closed — retrying when it reopens` : `OANDA did not close the trade (${reason})`, "BAD_ORDER");
        }
        const leg = f.tradesClosed?.find((t) => t.tradeID === pos.venueTradeId) ?? f.tradeReduced ?? f.tradesClosed?.[0];
        return await book(pos, row.id, {
          price: num(leg?.price ?? f.fullVWAP), units: num(leg?.units ?? f.units), pl: num(leg?.realizedPL ?? f.pl) || 0,
          commission: num(f.commission) || 0, financing: num(leg?.financing ?? f.financing) || 0, transactionId: f.id,
        }, i.reason, full);
      } catch (e) {
        if (e instanceof VenueError) throw e;
        await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "UNKNOWN", error: e instanceof Error ? e.message.slice(0, 300) : String(e) } });
        // Whatever happened, the trade state tells the truth.
        const booked = await syncOne(pos, row.id, i.reason);
        if (booked) return booked;
        if (e instanceof OandaError && e.status !== 0 && e.status < 500) {
          await prisma.sessionOrder.update({ where: { id: row.id }, data: { status: "REJECTED" } });
          throw new VenueError(e.message, "BAD_ORDER");
        }
        throw new VenueError(`Close of ${pos.symbol} outcome unknown — halting for safety`, "UNKNOWN_ORDER");
      }
    },

    async setStop(positionId: string, stopLoss: number) {
      const pos = await prisma.sessionPosition.findUnique({ where: { id: positionId } });
      if (!pos || pos.closedAt || !pos.venueTradeId) return null;
      const synced = await syncOne(pos);
      if (synced) return synced;
      const inst = await instrument(pos.symbol);
      await call("PUT", `/trades/${pos.venueTradeId}/orders`, { stopLoss: { price: roundStop(stopLoss, pos.side, inst.displayPrecision), timeInForce: "GTC" } });
      await prisma.sessionPosition.updateMany({ where: { id: positionId, closedAt: null }, data: { stopLoss } });
      await prisma.sessionOrder.updateMany({ where: { positionId, purpose: "STOP", status: "OPEN" }, data: { price: stopLoss } });
      return null;
    },

    async syncStops(sessionId: string) {
      const open = await prisma.sessionPosition.findMany({ where: { sessionId, closedAt: null, venueTradeId: { not: null } } });
      const booked: Array<{ positionId: string; result: CloseResult }> = [];
      for (const pos of open) {
        try {
          const r = await syncOne(pos);
          if (r) booked.push({ positionId: pos.id, result: r });
        } catch (e) {
          logger.warn({ positionId: pos.id, err: e instanceof Error ? e.message : String(e) }, "OANDA trade sync failed");
        }
      }
      return booked;
    },

    async reconcile(sessionId: string) {
      const issues: string[] = [];
      const trades = (await call<{ trades: OandaTrade[] }>("GET", "/openTrades")).trades;
      const prefix = `ab-${sessionId.slice(-10)}-`;
      const open = await prisma.sessionPosition.findMany({ where: { sessionId, closedAt: null } });
      for (const p of open) {
        const t = trades.find((x) => x.id === p.venueTradeId);
        if (!t) { issues.push(`${p.symbol} trade ${p.venueTradeId} is not open at OANDA`); continue; }
        const units = Math.abs(num(t.currentUnits));
        if (Math.abs(units - p.qty) > 1e-6 * Math.max(1, p.qty)) issues.push(`${p.symbol} trade ${t.id}: ${units} units at OANDA vs ${p.qty} in the ledger`);
      }
      for (const t of trades.filter((x) => x.clientExtensions?.id?.startsWith(prefix))) {
        if (!open.some((p) => p.venueTradeId === t.id)) issues.push(`OANDA trade ${t.id} (${t.instrument}) is not in the ledger`);
      }
      return issues;
    },
  };

  /**
   * If the OANDA trade behind a position is closed (stop-loss at the broker, a margin closeout, a manual
   * close in OANDA's app), book it. `rowId` reuses an existing order row; otherwise one is created.
   */
  async function syncOne(pos: SessionPosition, rowId?: string, fallbackReason: CloseIntent["reason"] = "MANUAL"): Promise<CloseResult | null> {
    if (!pos.venueTradeId) return null;
    const t = (await call<{ trade: OandaTrade & { closingTransactionIDs?: string[] } }>("GET", `/trades/${pos.venueTradeId}`)).trade;
    if (t.state === "OPEN") return null;
    const lastTx = t.closingTransactionIDs?.at(-1);
    const txReason = lastTx ? (await call<{ transaction: Tx }>("GET", `/transactions/${lastTx}`).catch(() => null))?.transaction.reason : undefined;
    const REASONS: Record<string, CloseIntent["reason"]> = {
      STOP_LOSS_ORDER: "STOP_LOSS", TRAILING_STOP_LOSS_ORDER: "STOP_LOSS", GUARANTEED_STOP_LOSS_ORDER: "STOP_LOSS",
      TAKE_PROFIT_ORDER: "TAKE_PROFIT", MARKET_ORDER_MARGIN_CLOSEOUT: "LIQUIDATION",
    };
    const mapped = txReason ? REASONS[txReason] : undefined;
    const reason: CloseIntent["reason"] = mapped ?? (t.stopLossOrder?.state === "FILLED" ? "STOP_LOSS" : fallbackReason);
    const id = rowId ?? (await prisma.sessionOrder.create({
      data: {
        sessionId: pos.sessionId, positionId: pos.id, clientOrderId: `ab-${pos.sessionId.slice(-10)}-bk-${pos.id.slice(-8)}`, symbol: pos.symbol,
        side: pos.side === "LONG" ? "SELL" : "BUY", type: "broker", purpose: reason === "STOP_LOSS" ? "STOP" : "EXIT", reduceOnly: true, amount: pos.qty, status: "PENDING",
      },
    })).id;
    return book(pos, id, {
      price: num(t.averageClosePrice), units: pos.qty, pl: num(t.realizedPL) || 0, commission: 0, financing: num(t.financing) || 0, transactionId: `trade-${t.id}-close`,
    }, reason, true);
  }

  return venue;
}
