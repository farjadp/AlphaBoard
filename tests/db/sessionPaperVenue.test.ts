/** Paper venue over the session ledger: fills, fees, idempotent replays, partial and full closes. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { FEE_RATE, SLIPPAGE } from "@/lib/paper/engine";
import { paperVenue, sessionFreeCapital } from "@/lib/venues/paper";
import { parseMandate } from "@/lib/sessions/mandate";

const run = !!process.env.TEST_DATABASE_URL;
const prices: Record<string, number | null> = { "BTC/USDT": 100 };
const venue = paperVenue(async (s) => prices[s] ?? null);
const plan = { takeProfit: 120, stopLoss: 90, invalidation: "x", horizonMin: 60 };

describe.skipIf(!run)("paper venue (Postgres)", () => {
  let sessionId: string;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    const user = await prisma.user.create({ data: { email: "venue@test.local", passwordHash: "x" } });
    const mandate = parseMandate({ symbols: ["BTC/USDT"], capital: 1_000, marketType: "swap", maxLeverage: 5 });
    sessionId = (await prisma.tradingSession.create({
      data: { userId: user.id, name: "t", mandate, capital: 1_000, endsAt: new Date(Date.now() + 3_600_000) },
    })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("reports market rules from the live price, or null without one", async () => {
    expect(await venue.marketRules("BTC/USDT")).toMatchObject({ price: 100, feeRate: FEE_RATE, slippage: SLIPPAGE });
    expect(await venue.marketRules("ETH/USDT")).toBeNull();
  });

  it("opens with slippage + fee, books margin, counts the trade", async () => {
    const r = await venue.openPosition({ sessionId, clientOrderId: "c1", symbol: "BTC/USDT", side: "LONG", qty: 10, leverage: 5, stopLoss: 90, takeProfit: 120, exitPlan: plan });
    const fill = 100 * (1 + SLIPPAGE);
    expect(r.replayed).toBe(false);
    expect(r.fill.price).toBeCloseTo(fill, 10);
    expect(r.fill.fee).toBeCloseTo(10 * fill * FEE_RATE, 10);
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } });
    expect(pos.margin).toBeCloseTo((10 * fill) / 5, 8);
    const s = await prisma.tradingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.tradesCount).toBe(1);
    expect(s.fees).toBeCloseTo(r.fill.fee, 10);
    expect(await sessionFreeCapital(sessionId)).toBeCloseTo(1_000 - r.fill.fee - pos.margin, 8);
  });

  it("replaying the same clientOrderId does not fill twice", async () => {
    const r = await venue.openPosition({ sessionId, clientOrderId: "c1", symbol: "BTC/USDT", side: "LONG", qty: 10, leverage: 5, stopLoss: 90, takeProfit: 120, exitPlan: plan });
    expect(r.replayed).toBe(true);
    expect(await prisma.sessionPosition.count({ where: { sessionId } })).toBe(1);
  });

  it("refuses an order the session capital cannot cover", async () => {
    await expect(venue.openPosition({ sessionId, clientOrderId: "c2", symbol: "BTC/USDT", side: "SHORT", qty: 100, leverage: 1, stopLoss: 110, takeProfit: null, exitPlan: plan }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CAPITAL" });
  });

  it("partial then full close add up to the whole trade", async () => {
    const pos = await prisma.sessionPosition.findFirstOrThrow({ where: { sessionId } });
    prices["BTC/USDT"] = 110;
    const half = await venue.closePosition({ sessionId, clientOrderId: "x1", positionId: pos.id, reason: "MANUAL", fraction: 0.5 });
    expect(half?.closed).toBe(false);
    expect(await venue.closePosition({ sessionId, clientOrderId: "x1", positionId: pos.id, reason: "MANUAL", fraction: 0.5 })).toBeNull();
    const rest = await venue.closePosition({ sessionId, clientOrderId: "x2", positionId: pos.id, reason: "TAKE_PROFIT" });
    expect(rest?.closed).toBe(true);

    const exit = 110 * (1 - SLIPPAGE);
    const entry = 100 * (1 + SLIPPAGE);
    const gross = (exit - entry) * 10;
    const fees = 10 * entry * FEE_RATE + 10 * exit * FEE_RATE;
    const closed = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: pos.id } });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closeReason).toBe("TAKE_PROFIT");
    expect(closed.realizedPnl).toBeCloseTo(gross - fees, 6);
    expect(half!.realizedPnl + rest!.realizedPnl).toBeCloseTo(gross - fees, 6);
    const s = await prisma.tradingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.realizedPnl - s.fees).toBeCloseTo(gross - fees, 6);
    expect(await sessionFreeCapital(sessionId)).toBeCloseTo(1_000 + gross - fees, 6);
    expect(await venue.closePosition({ sessionId, clientOrderId: "x3", positionId: pos.id, reason: "MANUAL" })).toBeNull();
  });

  it("caps an isolated loss at the margin", async () => {
    prices["BTC/USDT"] = 100;
    const r = await venue.openPosition({ sessionId, clientOrderId: "c3", symbol: "BTC/USDT", side: "LONG", qty: 5, leverage: 5, stopLoss: 90, takeProfit: null, exitPlan: plan });
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } });
    const res = await venue.closePosition({ sessionId, clientOrderId: "x4", positionId: pos.id, reason: "LIQUIDATION", price: 50 });
    expect(res!.realizedPnl).toBeCloseTo(-pos.margin - r.fill.fee - res!.fill.fee, 6);
    const order = await prisma.sessionOrder.findUniqueOrThrow({ where: { clientOrderId: "x4" } });
    expect(order).toMatchObject({ purpose: "STOP", reduceOnly: true, status: "FILLED" });
  });
});
