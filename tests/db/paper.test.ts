/** Paper trading against Postgres with injected prices/candles: cash accounting, ownership, tick settlement. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  closePaperPosition, getOrCreateAccount, openPaperPosition, paperOverview, resetPaperAccount, updatePositionExits,
} from "@/lib/paper/account";
import { FEE_RATE, SLIPPAGE } from "@/lib/paper/engine";
import { runTick } from "@/lib/jobs/tick";

const run = !!process.env.TEST_DATABASE_URL;
const prices: Record<string, number | null> = { "BTC/USDT": 100 };
const priceOf = async (s: string) => prices[s] ?? null;

describe.skipIf(!run)("paper trading (Postgres)", () => {
  let A: string, B: string;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "pa@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "pb@test.local", passwordHash: "x" } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("creates the account lazily at 10,000 USDT with a first equity point", async () => {
    const o = await paperOverview(A, priceOf);
    expect(o.account).toMatchObject({ startingBalance: 10_000, cash: 10_000, equity: 10_000, returnPct: 0, currency: "USDT" });
    expect(o.equityCurve).toHaveLength(1);
    expect((await getOrCreateAccount(A)).id).toBe((await getOrCreateAccount(A)).id);
  });

  it("opens a position: debits margin + fee, records the order, marks it live", async () => {
    prices["BTC/USDT"] = 100;
    const pos = await openPaperPosition(A, { symbol: "BTC/USDT", side: "LONG", margin: 1_000, leverage: 2, stopLoss: 90, takeProfit: 120 }, priceOf);
    expect(pos.entryPrice).toBeCloseTo(100 * (1 + SLIPPAGE), 10);
    const o = await paperOverview(A, priceOf);
    expect(o.account.cash).toBeCloseTo(10_000 - 1_000 - 2_000 * FEE_RATE, 8);
    expect(o.positions).toHaveLength(1);
    expect(o.positions[0]).toMatchObject({ symbol: "BTC/USDT", side: "LONG", markPrice: 100, liquidationPrice: expect.any(Number) });
    expect(o.orders[0]).toMatchObject({ action: "BUY", reason: "OPEN" });
  });

  it("refuses orders it cannot fill honestly", async () => {
    await expect(openPaperPosition(A, { symbol: "NOPE", side: "LONG", margin: 10, leverage: 1 }, priceOf)).rejects.toMatchObject({ status: 400 });
    await expect(openPaperPosition(A, { symbol: "ETH/USDT", side: "LONG", margin: 10, leverage: 1 }, priceOf)).rejects.toMatchObject({ status: 503, code: "PRICE_UNAVAILABLE" });
    await expect(openPaperPosition(A, { symbol: "BTC/USDT", side: "LONG", margin: 50_000, leverage: 1 }, priceOf)).rejects.toMatchObject({ code: "INSUFFICIENT_CASH" });
    await expect(openPaperPosition(A, { symbol: "BTC/USDT", side: "SHORT", margin: 10, leverage: 1, stopLoss: 90 }, priceOf)).rejects.toMatchObject({ code: "BAD_STOP" });
  });

  it("another user cannot see, edit or close the position", async () => {
    const [pos] = (await paperOverview(A, priceOf)).positions;
    expect((await paperOverview(B, priceOf)).positions).toHaveLength(0);
    await expect(closePaperPosition(B, pos.id, priceOf)).rejects.toMatchObject({ status: 404 });
    await expect(updatePositionExits(B, pos.id, { stopLoss: 95, takeProfit: null }, priceOf)).rejects.toMatchObject({ status: 404 });
  });

  it("marks equity as unavailable (not a guess) when the quote is missing", async () => {
    prices["BTC/USDT"] = null;
    const o = await paperOverview(A, priceOf);
    expect(o.account.equity).toBeNull();
    expect(o.positions[0].unrealizedPnl).toBeNull();
    prices["BTC/USDT"] = 100;
  });

  it("the tick closes on a candle low through the stop, at the stop minus slippage; a second close is a no-op", async () => {
    const [pos] = (await paperOverview(A, priceOf)).positions;
    const t0 = new Date(pos.openedAt).getTime();
    const bars = [
      { time: t0 - 60_000, open: 100, high: 101, low: 50, close: 100 },          // started before entry: ignored
      { time: t0 + 300_000, open: 100, high: 102, low: 99, close: 101 },
      { time: t0 + 600_000, open: 101, high: 101, low: 89, close: 90 },          // through the 90 stop
    ];
    const r = await runTick({ now: () => new Date(t0 + 700_000), barsOf: async () => bars, priceOf, signalBarsOf: async () => null });
    expect(r.closed).toEqual([{ id: pos.id, symbol: "BTC/USDT", reason: "STOP_LOSS" }]);

    const o = await paperOverview(A, priceOf);
    expect(o.positions).toHaveLength(0);
    const h = o.history[0];
    expect(h).toMatchObject({ closeReason: "STOP_LOSS" });
    expect(h.closePrice).toBeCloseTo(90 * (1 - SLIPPAGE), 10);
    const expectedPnl = (h.closePrice! - pos.entryPrice) * pos.qty - pos.fees - h.closePrice! * pos.qty * FEE_RATE;
    expect(h.realizedPnl).toBeCloseTo(expectedPnl, 6);
    expect(o.account.cash).toBeCloseTo(10_000 + expectedPnl, 6);
    expect(o.account.equity).toBeCloseTo(o.account.cash, 8);
    await expect(closePaperPosition(A, pos.id, priceOf)).rejects.toMatchObject({ code: "CLOSED" });
    expect(await prisma.appSetting.findUnique({ where: { key: "tick.last" } })).not.toBeNull();
  });

  it("the tick leaves positions alone while price stays inside and advances lastCheckedAt", async () => {
    const pos = await openPaperPosition(A, { symbol: "BTC/USDT", side: "SHORT", margin: 500, leverage: 3, stopLoss: 110, takeProfit: 80 }, priceOf);
    const t0 = pos.openedAt.getTime();
    const bars = [{ time: t0 + 300_000, open: 100, high: 105, low: 95, close: 100 }];
    const r = await runTick({ now: () => new Date(t0 + 400_000), barsOf: async () => bars, priceOf, signalBarsOf: async () => null });
    expect(r.closed).toEqual([]);
    const after = await prisma.paperPosition.findUniqueOrThrow({ where: { id: pos.id } });
    expect(after.lastCheckedAt.getTime()).toBe(t0 + 300_000);
    expect(after.closedAt).toBeNull();
  });

  it("manual close settles at the quote; SL/TP edits are validated against the live price", async () => {
    const [pos] = (await paperOverview(A, priceOf)).positions;
    await expect(updatePositionExits(A, pos.id, { stopLoss: 99, takeProfit: null }, priceOf)).rejects.toMatchObject({ code: "BAD_STOP" });
    await updatePositionExits(A, pos.id, { stopLoss: 104, takeProfit: 85 }, priceOf);
    prices["BTC/USDT"] = 95;
    const res = await closePaperPosition(A, pos.id, priceOf);
    expect(res.reason).toBe("MANUAL");
    expect(res.exitPrice).toBeCloseTo(95 * (1 + SLIPPAGE), 10);
    expect(res.grossPnl).toBeGreaterThan(0);
    const o = await paperOverview(A, priceOf);
    expect(o.account.closedCount).toBe(2);
    expect(o.account.winCount).toBe(1);
  });

  it("links a position to the user's own signal only", async () => {
    const mine = await prisma.signal.create({ data: { userId: A, symbol: "BTC/USDT", timeframe: "4H", signal: "BUY", confidence: 60, priceAtSignal: 95, entry: 95, stopLoss: 90, takeProfit: 105, reasoning: "r", provider: "openai", model: "m" } });
    const theirs = await prisma.signal.create({ data: { userId: B, symbol: "BTC/USDT", timeframe: "4H", signal: "BUY", confidence: 60, priceAtSignal: 95, entry: 95, stopLoss: 90, takeProfit: 105, reasoning: "r", provider: "openai", model: "m" } });
    const pos = await openPaperPosition(A, { symbol: "BTC/USDT", side: "LONG", margin: 100, leverage: 1, signalId: mine.id }, priceOf);
    expect(pos.signalId).toBe(mine.id);
    await expect(openPaperPosition(A, { symbol: "BTC/USDT", side: "LONG", margin: 100, leverage: 1, signalId: theirs.id }, priceOf)).rejects.toMatchObject({ status: 404 });
  });

  it("reset wipes positions, orders and the curve and starts over at the chosen balance", async () => {
    await resetPaperAccount(A, 25_000);
    const o = await paperOverview(A, priceOf);
    expect(o.account).toMatchObject({ startingBalance: 25_000, cash: 25_000, equity: 25_000, closedCount: 0 });
    expect(o.positions).toHaveLength(0);
    expect(o.orders).toHaveLength(0);
    expect(o.equityCurve).toHaveLength(1);
  });
});
