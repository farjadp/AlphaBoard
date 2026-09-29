/** ccxt venue against Postgres with a fake exchange: fills, fees, replays, unknown outcomes, closes. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { parseMandate } from "@/lib/sessions/mandate";
import { ccxtVenue, feeOf } from "@/lib/venues/ccxt";
import { setExchangeFactory } from "@/lib/venues/ccxtClient";
import { fakeExchange, market } from "../setup/fakeExchange";
import { encryptSecret } from "@/lib/secrets/crypto";

const run = !!process.env.TEST_DATABASE_URL;
process.env.EXCHANGE_KEY_SECRET = randomBytes(32).toString("base64");

describe("feeOf", () => {
  it("converts base-asset fees and estimates unknown-currency fees", () => {
    expect(feeOf({ id: "1", symbol: "BTC/USDT", fee: { cost: 0.001, currency: "BTC" } }, market, 100, 1)).toEqual({ quote: 0.1, base: 0.001 });
    expect(feeOf({ id: "1", symbol: "BTC/USDT", fee: { cost: 2, currency: "USDT" } }, market, 100, 1)).toEqual({ quote: 2, base: 0 });
    expect(feeOf({ id: "1", symbol: "BTC/USDT", fee: { cost: 0.01, currency: "BNB" } }, market, 100, 1).quote).toBeCloseTo(0.1, 10);
  });
});

describe.skipIf(!run)("ccxt venue (Postgres, fake exchange)", () => {
  let sessionId: string;
  let conn: Awaited<ReturnType<typeof prisma.exchangeConnection.create>>;
  let fake: ReturnType<typeof fakeExchange>;
  const venue = () => ccxtVenue(conn, { sleep: async () => undefined, lookupTries: 2 });
  const plan = { thesis: "t", invalidation: "i", horizonMin: 60 };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    const user = await prisma.user.create({ data: { email: "cx@test.local", passwordHash: "x", role: "ADMIN" } });
    conn = await prisma.exchangeConnection.create({
      data: { userId: user.id, exchange: "binance", label: "t", sandbox: true, apiKeyEnc: encryptSecret("k"), secretEnc: encryptSecret("s"), keyLast4: "k", status: "OK" },
    });
    const mandate = parseMandate({ symbols: ["BTC/USDT"], capital: 500 });
    sessionId = (await prisma.tradingSession.create({ data: { userId: user.id, name: "t", mandate, capital: 500, venue: "exchange", connectionId: conn.id, endsAt: new Date(Date.now() + 3_600_000) } })).id;
  });
  beforeEach(async () => {
    fake = fakeExchange();
    setExchangeFactory(async () => fake.ex);
    await prisma.sessionOrder.deleteMany({});
    await prisma.sessionPosition.deleteMany({});
    await prisma.tradingSession.update({ where: { id: sessionId }, data: { fees: 0, realizedPnl: 0, tradesCount: 0 } });
  });
  afterAll(async () => { setExchangeFactory(null); await prisma.$disconnect(); });

  it("market rules come from the exchange", async () => {
    expect(await venue().marketRules("BTC/USDT")).toMatchObject({ price: 100_000, minQty: 0.00001, minCost: 5, qtyStep: 0.00001, feeRate: 0.001 });
    expect(venue().live).toBe(false);
  });

  it("opens: records the fill, converts the base-asset fee and holds the net quantity", async () => {
    const r = await venue().openPosition({ sessionId, clientOrderId: "cx-1", symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss: 95_000, takeProfit: null, exitPlan: plan });
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } });
    expect(pos.qty).toBeCloseTo(0.001 * 0.999, 12);
    expect(pos.entryPrice).toBe(100_000);
    expect(pos.fees).toBeCloseTo(0.1, 8);
    const order = await prisma.sessionOrder.findUniqueOrThrow({ where: { clientOrderId: "cx-1" } });
    expect(order).toMatchObject({ status: "FILLED", venueOrderId: "o1", purpose: "ENTRY" });
    const again = await venue().openPosition({ sessionId, clientOrderId: "cx-1", symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss: 95_000, takeProfit: null, exitPlan: plan });
    expect(again.replayed).toBe(true);
    expect(fake.state.calls).toBe(1);
  });

  it("a timeout is resolved by looking the order up, never by sending it again", async () => {
    fake.state.mode = "timeout-found";
    const r = await venue().openPosition({ sessionId, clientOrderId: "cx-2", symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss: 95_000, takeProfit: null, exitPlan: plan });
    expect(r.replayed).toBe(false);
    expect(fake.state.calls).toBe(1);
    expect(await prisma.sessionPosition.count({ where: { sessionId } })).toBe(1);
  });

  it("an order that cannot be found after a timeout is UNKNOWN and is never re-sent", async () => {
    fake.state.mode = "timeout-missing";
    await expect(venue().openPosition({ sessionId, clientOrderId: "cx-3", symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss: 95_000, takeProfit: null, exitPlan: plan }))
      .rejects.toMatchObject({ code: "UNKNOWN_ORDER" });
    expect((await prisma.sessionOrder.findUniqueOrThrow({ where: { clientOrderId: "cx-3" } })).status).toBe("UNKNOWN");
    fake.state.mode = "fill";
    await expect(venue().openPosition({ sessionId, clientOrderId: "cx-3", symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss: 95_000, takeProfit: null, exitPlan: plan }))
      .rejects.toMatchObject({ code: "UNKNOWN_ORDER" });
    expect(fake.state.calls).toBe(1);
  });

  it("an exchange rejection is recorded and surfaced", async () => {
    fake.state.mode = "reject";
    await expect(venue().openPosition({ sessionId, clientOrderId: "cx-4", symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss: 95_000, takeProfit: null, exitPlan: plan }))
      .rejects.toMatchObject({ code: "BAD_ORDER" });
    expect((await prisma.sessionOrder.findUniqueOrThrow({ where: { clientOrderId: "cx-4" } })).status).toBe("REJECTED");
  });

  it("refuses shorts on spot and new entries under TRADING_HALT", async () => {
    await expect(venue().openPosition({ sessionId, clientOrderId: "cx-5", symbol: "BTC/USDT", side: "SHORT", qty: 0.001, leverage: 1, stopLoss: 105_000, takeProfit: null, exitPlan: plan }))
      .rejects.toMatchObject({ code: "BAD_ORDER" });
    process.env.TRADING_HALT = "1";
    await expect(venue().openPosition({ sessionId, clientOrderId: "cx-6", symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss: 95_000, takeProfit: null, exitPlan: plan }))
      .rejects.toMatchObject({ code: "HALTED" });
    delete process.env.TRADING_HALT;
  });

  it("closes what is actually held and books net P&L", async () => {
    const r = await venue().openPosition({ sessionId, clientOrderId: "cx-7", symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss: 95_000, takeProfit: null, exitPlan: plan });
    fake.state.price = 110_000;
    const c = await venue().closePosition({ sessionId, clientOrderId: "cx-8", positionId: r.positionId, reason: "MANUAL" });
    expect(c?.closed).toBe(true);
    const sold = 0.00099; // 0.000999 held, floored to the 0.00001 step
    expect(c!.fill.qty).toBeCloseTo(sold, 12);
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } });
    expect(pos.closedAt).not.toBeNull();
    const gross = (110_000 - 100_000) * sold;
    const entryFeeShare = 0.1 * (sold / 0.000999);
    const exitFee = sold * 110_000 * 0.001;
    expect(pos.realizedPnl).toBeCloseTo(gross - entryFeeShare - exitFee, 6);
    expect(await venue().closePosition({ sessionId, clientOrderId: "cx-9", positionId: r.positionId, reason: "MANUAL" })).toBeNull();
  });
});
