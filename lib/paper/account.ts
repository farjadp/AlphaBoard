import "server-only";
import type { PaperPosition, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { badRequest, HttpError, notFound } from "@/lib/http/errors";
import { getQuote } from "@/lib/market/quote";
import type { PaperOrderDto, PaperOverview, PaperPositionDto } from "@/lib/types/paper";
import {
  PaperRuleError, closePosition, equityOf, liquidationPrice, markPosition, openPosition, validateExits,
  type ExitReason, type PaperSide,
} from "./engine";

export const DEFAULT_STARTING_BALANCE = 10_000;
export const MAX_OPEN_POSITIONS = 50;

/** Live price for a catalog symbol, or null when every provider fails. Injected in tests. */
export type PriceOf = (symbol: string) => Promise<number | null>;

export const livePrice: PriceOf = async (symbol) => {
  const asset = findAsset(symbol);
  return asset ? (await getQuote(asset))?.price ?? null : null;
};

const rule = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof PaperRuleError) throw badRequest(e.message, e.code);
    throw e;
  }
};

/** Lazily opens the account with the default balance; the equity curve starts at that balance. */
export async function getOrCreateAccount(userId: string) {
  const existing = await prisma.paperAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await prisma.paperAccount.create({
      data: {
        userId, startingBalance: DEFAULT_STARTING_BALANCE, cashBalance: DEFAULT_STARTING_BALANCE, snapshotAt: new Date(),
        equity: { create: { equity: DEFAULT_STARTING_BALANCE } },
      },
    });
  } catch (e) {
    // Two first requests raced on the unique userId; the other one won.
    if ((e as { code?: string }).code === "P2002") return prisma.paperAccount.findUniqueOrThrow({ where: { userId } });
    throw e;
  }
}

async function ownedOpenPosition(userId: string, id: string) {
  const pos = await prisma.paperPosition.findFirst({ where: { id, account: { userId } } });
  if (!pos) throw notFound("Position not found");
  if (pos.closedAt) throw badRequest("Position is already closed", "CLOSED");
  return pos;
}

async function priceOrFail(priceOf: PriceOf, symbol: string) {
  const price = await priceOf(symbol);
  if (price == null || !(price > 0)) throw new HttpError(503, `Live price for ${symbol} is unavailable right now`, "PRICE_UNAVAILABLE");
  return price;
}

export interface OpenInput {
  symbol: string;
  side: PaperSide;
  margin: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  signalId?: string;
}

export async function openPaperPosition(userId: string, input: OpenInput, priceOf: PriceOf = livePrice) {
  if (!findAsset(input.symbol)) throw badRequest("Unsupported symbol", "BAD_SYMBOL");
  if (input.signalId && !(await prisma.signal.findFirst({ where: { id: input.signalId, userId }, select: { id: true } }))) {
    throw notFound("Signal not found");
  }
  const account = await getOrCreateAccount(userId);
  if ((await prisma.paperPosition.count({ where: { accountId: account.id, closedAt: null } })) >= MAX_OPEN_POSITIONS) {
    throw badRequest(`At most ${MAX_OPEN_POSITIONS} open positions`, "LIMIT");
  }
  const price = await priceOrFail(priceOf, input.symbol);
  const fill = rule(() => openPosition({ ...input, price, cash: account.cashBalance }));
  const cost = input.margin + fill.fee;

  const position = await prisma.$transaction(async (tx) => {
    // Conditional debit: a concurrent order cannot spend the same cash twice.
    const debited = await tx.paperAccount.updateMany({
      where: { id: account.id, cashBalance: { gte: cost } },
      data: { cashBalance: { decrement: cost } },
    });
    if (debited.count !== 1) throw badRequest("Not enough cash for margin + fee", "INSUFFICIENT_CASH");
    const pos = await tx.paperPosition.create({
      data: {
        accountId: account.id, symbol: input.symbol, side: input.side, qty: fill.qty, entryPrice: fill.fillPrice,
        leverage: input.leverage, margin: input.margin, stopLoss: input.stopLoss ?? null, takeProfit: input.takeProfit ?? null,
        signalId: input.signalId ?? null, fees: fill.fee,
      },
    });
    await tx.paperOrder.create({
      data: {
        accountId: account.id, positionId: pos.id, symbol: input.symbol, action: input.side === "LONG" ? "BUY" : "SELL",
        qty: fill.qty, requestedPrice: price, fillPrice: fill.fillPrice, slippage: fill.slippage, fee: fill.fee, reason: "OPEN",
      },
    });
    return pos;
  });
  await snapshotEquity(account.id, priceOf);
  return position;
}

/**
 * Settle an open position at `price` (quote for manual closes, the triggered level for SL/TP).
 * Idempotent: returns null when someone else (the tick, another tab) already closed it.
 */
export async function settlePosition(pos: PaperPosition, reason: ExitReason | "MANUAL", price: number, now = new Date()) {
  const s = closePosition(pos, price, pos.fees);
  return prisma.$transaction(async (tx) => {
    const closed = await tx.paperPosition.updateMany({
      where: { id: pos.id, closedAt: null },
      data: { closedAt: now, closePrice: s.exitPrice, realizedPnl: s.realizedPnl, closeReason: reason, fees: { increment: s.exitFee } },
    });
    if (closed.count !== 1) return null;
    await tx.paperAccount.update({ where: { id: pos.accountId }, data: { cashBalance: { increment: s.cashCredit } } });
    await tx.paperOrder.create({
      data: {
        accountId: pos.accountId, positionId: pos.id, symbol: pos.symbol, action: pos.side === "LONG" ? "SELL" : "BUY",
        qty: pos.qty, requestedPrice: price, fillPrice: s.exitPrice, slippage: s.slippage, fee: s.exitFee, reason,
      },
    });
    return { ...s, reason };
  });
}

export async function closePaperPosition(userId: string, id: string, priceOf: PriceOf = livePrice) {
  const pos = await ownedOpenPosition(userId, id);
  const price = await priceOrFail(priceOf, pos.symbol);
  const result = await settlePosition(pos, "MANUAL", price);
  if (!result) throw badRequest("Position is already closed", "CLOSED");
  await snapshotEquity(pos.accountId, priceOf);
  return result;
}

export async function updatePositionExits(
  userId: string, id: string, input: { stopLoss: number | null; takeProfit: number | null }, priceOf: PriceOf = livePrice,
) {
  const pos = await ownedOpenPosition(userId, id);
  // Against the live price: a level already crossed would close the position on the next tick.
  const price = await priceOrFail(priceOf, pos.symbol);
  rule(() => validateExits(pos.side, price, input.stopLoss, input.takeProfit));
  await prisma.paperPosition.updateMany({ where: { id, closedAt: null }, data: input });
}

/** Wipe positions, orders and the equity curve; start over with a new balance. */
export async function resetPaperAccount(userId: string, startingBalance = DEFAULT_STARTING_BALANCE) {
  const account = await getOrCreateAccount(userId);
  await prisma.$transaction([
    prisma.paperOrder.deleteMany({ where: { accountId: account.id } }),
    prisma.paperPosition.deleteMany({ where: { accountId: account.id } }),
    prisma.equitySnapshot.deleteMany({ where: { accountId: account.id } }),
    prisma.paperAccount.update({
      where: { id: account.id },
      data: { startingBalance, cashBalance: startingBalance, resetAt: new Date(), snapshotAt: new Date() },
    }),
    prisma.equitySnapshot.create({ data: { accountId: account.id, equity: startingBalance } }),
  ]);
}

async function markOpen(positions: PaperPosition[], priceOf: PriceOf) {
  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const prices = new Map(await Promise.all(symbols.map(async (s) => [s, await priceOf(s).catch(() => null)] as const)));
  return positions.map((p) => {
    const mark = prices.get(p.symbol) ?? null;
    return { pos: p, markPrice: mark, unrealizedPnl: mark == null ? null : markPosition(p, mark) };
  });
}

/** Record the current equity (skipped when a mark is unavailable — never snapshot a guess). */
export async function snapshotEquity(accountId: string, priceOf: PriceOf = livePrice, now = new Date()) {
  const [account, open] = await Promise.all([
    prisma.paperAccount.findUnique({ where: { id: accountId } }),
    prisma.paperPosition.findMany({ where: { accountId, closedAt: null } }),
  ]);
  if (!account) return null;
  const equity = equityOf(account.cashBalance, (await markOpen(open, priceOf)).map((m) => ({ margin: m.pos.margin, unrealizedPnl: m.unrealizedPnl })));
  if (equity == null) return null;
  await prisma.$transaction([
    prisma.equitySnapshot.create({ data: { accountId, equity, at: now } }),
    prisma.paperAccount.update({ where: { id: accountId }, data: { snapshotAt: now } }),
  ]);
  return equity;
}

function positionDto(p: PaperPosition, mark: { markPrice: number | null; unrealizedPnl: number | null } | null): PaperPositionDto {
  return {
    id: p.id, symbol: p.symbol, side: p.side, qty: p.qty, entryPrice: p.entryPrice, leverage: p.leverage, margin: p.margin,
    stopLoss: p.stopLoss, takeProfit: p.takeProfit, liquidationPrice: liquidationPrice(p.side, p.entryPrice, p.leverage),
    signalId: p.signalId, fees: p.fees, openedAt: p.openedAt.toISOString(),
    markPrice: mark?.markPrice ?? null, unrealizedPnl: mark?.unrealizedPnl ?? null,
    closedAt: p.closedAt?.toISOString() ?? null, closePrice: p.closePrice, realizedPnl: p.realizedPnl, closeReason: p.closeReason,
  };
}

const orderDto = (o: Prisma.PaperOrderGetPayload<object>): PaperOrderDto => ({
  id: o.id, positionId: o.positionId, symbol: o.symbol, action: o.action, qty: o.qty, requestedPrice: o.requestedPrice,
  fillPrice: o.fillPrice, fee: o.fee, reason: o.reason, createdAt: o.createdAt.toISOString(),
});

export async function paperOverview(userId: string, priceOf: PriceOf = livePrice): Promise<PaperOverview> {
  const account = await getOrCreateAccount(userId);
  const [open, history, orders, curve, realized, wins] = await Promise.all([
    prisma.paperPosition.findMany({ where: { accountId: account.id, closedAt: null }, orderBy: { openedAt: "desc" } }),
    prisma.paperPosition.findMany({ where: { accountId: account.id, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take: 100 }),
    prisma.paperOrder.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.equitySnapshot.findMany({ where: { accountId: account.id }, orderBy: { at: "desc" }, take: 2_000 }),
    prisma.paperPosition.aggregate({ where: { accountId: account.id, closedAt: { not: null } }, _sum: { realizedPnl: true }, _count: true }),
    prisma.paperPosition.count({ where: { accountId: account.id, closedAt: { not: null }, realizedPnl: { gt: 0 } } }),
  ]);
  const marked = await markOpen(open, priceOf);
  const unrealized = marked.some((m) => m.unrealizedPnl == null) ? null : marked.reduce((s, m) => s + m.unrealizedPnl!, 0);
  const equity = equityOf(account.cashBalance, marked.map((m) => ({ margin: m.pos.margin, unrealizedPnl: m.unrealizedPnl })));

  return {
    account: {
      startingBalance: account.startingBalance, cash: account.cashBalance, currency: account.currency,
      createdAt: account.createdAt.toISOString(), resetAt: account.resetAt?.toISOString() ?? null,
      usedMargin: open.reduce((s, p) => s + p.margin, 0), unrealizedPnl: unrealized,
      realizedPnl: realized._sum.realizedPnl ?? 0, equity,
      returnPct: equity == null ? null : ((equity - account.startingBalance) / account.startingBalance) * 100,
      closedCount: realized._count, winCount: wins,
    },
    positions: marked.map((m) => positionDto(m.pos, m)),
    history: history.map((p) => positionDto(p, null)),
    orders: orders.map(orderDto),
    equityCurve: curve.reverse().map((c) => ({ at: c.at.toISOString(), equity: c.equity })),
  };
}
