import "server-only";
import { prisma } from "@/lib/prisma";
import { applySlippage, FEE_RATE, SLIPPAGE } from "@/lib/paper/engine";
import type { PriceOf } from "@/lib/paper/account";
import type { MarketRules } from "@/lib/risk/verdict";
import { VenueError, type CloseIntent, type OpenIntent, type Venue } from "./types";

/** Paper fills never have exchange minimums beyond this dust guard. */
export const PAPER_RULES = { minQty: 1e-8, qtyStep: 1e-8, minCost: 1 } as const;

const entryAction = (side: "LONG" | "SHORT") => (side === "LONG" ? "BUY" : "SELL");
const exitAction = (side: "LONG" | "SHORT") => (side === "LONG" ? "SELL" : "BUY");

/** Session capital not tied up as margin: capital + realized − fees − open margin. */
export async function sessionFreeCapital(sessionId: string, db: Pick<typeof prisma, "tradingSession" | "sessionPosition"> = prisma) {
  const s = await db.tradingSession.findUniqueOrThrow({ where: { id: sessionId }, select: { capital: true, realizedPnl: true, fees: true } });
  const open = await db.sessionPosition.aggregate({ where: { sessionId, closedAt: null }, _sum: { margin: true } });
  return s.capital + s.realizedPnl - s.fees - (open._sum.margin ?? 0);
}

/**
 * Simulated venue over the session ledger (P4 fill model: live quote ± 0.05% slippage, 0.05% fee per
 * side). Isolated margin: a position can lose at most its margin. Orders are keyed by clientOrderId,
 * so replaying an intent returns the first fill instead of filling twice.
 */
export function paperVenue(priceOf: PriceOf): Venue {
  async function livePrice(symbol: string, override?: number) {
    const price = override ?? (await priceOf(symbol));
    if (price == null || !(price > 0)) throw new VenueError(`${symbol} price unavailable`, "PRICE_UNAVAILABLE");
    return price;
  }

  return {
    kind: "paper",
    live: false,

    async marketRules(symbol: string): Promise<MarketRules | null> {
      const price = await priceOf(symbol).catch(() => null);
      if (price == null || !(price > 0)) return null;
      return { price, ...PAPER_RULES, feeRate: FEE_RATE, slippage: SLIPPAGE };
    },

    async openPosition(i: OpenIntent) {
      const existing = await prisma.sessionOrder.findUnique({ where: { clientOrderId: i.clientOrderId } });
      if (existing?.positionId) {
        return {
          positionId: existing.positionId, replayed: true,
          fill: { orderId: existing.id, clientOrderId: existing.clientOrderId, price: existing.avgPrice ?? 0, qty: existing.filled, fee: existing.fee ?? 0 },
        };
      }
      if (!(i.qty > 0) || !(i.leverage >= 1)) throw new VenueError("Order size and leverage must be positive", "BAD_ORDER");
      const ref = await livePrice(i.symbol);
      const price = applySlippage(entryAction(i.side), ref);
      const notional = i.qty * price;
      const fee = notional * FEE_RATE;
      const margin = notional / i.leverage;

      return prisma.$transaction(async (tx) => {
        const free = await sessionFreeCapital(i.sessionId, tx);
        if (margin + fee > free + 1e-9) throw new VenueError(`Not enough session capital: need ${(margin + fee).toFixed(2)}, free ${free.toFixed(2)}`, "INSUFFICIENT_CAPITAL");
        const pos = await tx.sessionPosition.create({
          data: {
            sessionId: i.sessionId, symbol: i.symbol, side: i.side, qty: i.qty, entryPrice: price, leverage: i.leverage, margin,
            stopLoss: i.stopLoss, takeProfit: i.takeProfit, exitPlan: i.exitPlan as object, fees: fee,
          },
        });
        const order = await tx.sessionOrder.create({
          data: {
            sessionId: i.sessionId, positionId: pos.id, clientOrderId: i.clientOrderId, venueOrderId: `paper-${i.clientOrderId}`,
            symbol: i.symbol, side: entryAction(i.side), type: "market", purpose: "ENTRY", amount: i.qty, price: ref,
            status: "FILLED", filled: i.qty, avgPrice: price, fee,
          },
        });
        await tx.tradingSession.update({ where: { id: i.sessionId }, data: { fees: { increment: fee }, tradesCount: { increment: 1 } } });
        return { positionId: pos.id, replayed: false, fill: { orderId: order.id, clientOrderId: i.clientOrderId, price, qty: i.qty, fee } };
      });
    },

    async closePosition(i: CloseIntent) {
      const pos = await prisma.sessionPosition.findFirst({ where: { id: i.positionId, sessionId: i.sessionId } });
      if (!pos || pos.closedAt) return null;
      if (await prisma.sessionOrder.findUnique({ where: { clientOrderId: i.clientOrderId }, select: { id: true } })) return null;
      const fraction = Math.min(1, Math.max(0, i.fraction ?? 1));
      if (!(fraction > 0)) throw new VenueError("Close fraction must be positive", "BAD_ORDER");
      const ref = await livePrice(pos.symbol, i.price);
      const price = applySlippage(exitAction(pos.side), ref);
      const full = fraction >= 1 - 1e-9;
      const qty = full ? pos.qty : pos.qty * fraction;
      const marginPart = full ? pos.margin : pos.margin * fraction;
      const gross = Math.max(-marginPart, (pos.side === "LONG" ? price - pos.entryPrice : pos.entryPrice - price) * qty);
      const exitFee = qty * price * FEE_RATE;

      return prisma.$transaction(async (tx) => {
        const entry = await tx.sessionOrder.aggregate({ where: { positionId: pos.id, purpose: "ENTRY" }, _sum: { fee: true, filled: true } });
        // The entry fee is attributed pro rata to the quantity closed, so partial closes add up to the whole.
        const openedQty = entry._sum.filled || pos.qty;
        const entryFeeShare = (entry._sum.fee ?? 0) * (qty / openedQty);
        const net = gross - entryFeeShare - exitFee;
        const changed = full
          ? await tx.sessionPosition.updateMany({
            where: { id: pos.id, closedAt: null, qty: pos.qty },
            data: { closedAt: new Date(), closePrice: price, realizedPnl: (pos.realizedPnl ?? 0) + net, closeReason: i.reason, fees: { increment: exitFee } },
          })
          : await tx.sessionPosition.updateMany({
            where: { id: pos.id, closedAt: null, qty: pos.qty },
            data: { qty: pos.qty - qty, margin: pos.margin - marginPart, realizedPnl: (pos.realizedPnl ?? 0) + net, fees: { increment: exitFee } },
          });
        if (changed.count !== 1) return null;
        const order = await tx.sessionOrder.create({
          data: {
            sessionId: i.sessionId, positionId: pos.id, clientOrderId: i.clientOrderId, venueOrderId: `paper-${i.clientOrderId}`,
            symbol: pos.symbol, side: exitAction(pos.side), type: "market",
            purpose: i.reason === "STOP_LOSS" || i.reason === "LIQUIDATION" ? "STOP" : i.reason === "TAKE_PROFIT" ? "TAKE_PROFIT" : "EXIT",
            reduceOnly: true, amount: qty, price: ref, status: "FILLED", filled: qty, avgPrice: price, fee: exitFee,
          },
        });
        await tx.tradingSession.update({ where: { id: i.sessionId }, data: { realizedPnl: { increment: gross }, fees: { increment: exitFee } } });
        return { fill: { orderId: order.id, clientOrderId: i.clientOrderId, price, qty, fee: exitFee }, realizedPnl: net, closed: full };
      });
    },

    async setStop(positionId: string, stopLoss: number) {
      await prisma.sessionPosition.updateMany({ where: { id: positionId, closedAt: null }, data: { stopLoss } });
    },
  };
}
