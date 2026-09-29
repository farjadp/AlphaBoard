/** OANDA venue (P9) against Postgres with an in-memory OANDA v20 server. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secrets/crypto";
import { parseMandate } from "@/lib/sessions/mandate";
import { oandaInstrument, oandaVenue, roundStop, setOandaFetch } from "@/lib/venues/oanda";
import { startSession } from "@/lib/sessions/service";
import { reconcileSession } from "@/lib/exec/reconciler";
import { fakeOanda } from "../setup/fakeOanda";

const run = !!process.env.TEST_DATABASE_URL;
process.env.EXCHANGE_KEY_SECRET = randomBytes(32).toString("base64");

describe("OANDA helpers", () => {
  it("maps catalog symbols to instruments", () => {
    expect(oandaInstrument("XAU/USD")).toBe("XAU_USD");
    expect(oandaInstrument("EUR/USD")).toBe("EUR_USD");
    expect(oandaInstrument("WTI")).toBe("WTICO_USD");
  });
  it("rounds stops away from the market", () => {
    expect(roundStop(2590.1239, "LONG", 3)).toBe("2590.123");
    expect(roundStop(2610.1231, "SHORT", 3)).toBe("2610.124");
  });
});

describe.skipIf(!run)("OANDA venue (Postgres, fake v20 server)", () => {
  let userId: string, sessionId: string;
  let conn: Awaited<ReturnType<typeof prisma.exchangeConnection.create>>;
  let fake: ReturnType<typeof fakeOanda>;
  const venue = () => oandaVenue(conn, { sleep: async () => undefined, lookupTries: 2 });
  let n = 0;
  const open = (o: Partial<{ side: "LONG" | "SHORT"; qty: number; stopLoss: number; symbol: string }> = {}) =>
    venue().openPosition({ sessionId, clientOrderId: `ab-oa-${++n}`, symbol: o.symbol ?? "XAU/USD", side: o.side ?? "LONG", qty: o.qty ?? 2.7, leverage: 5, stopLoss: o.stopLoss ?? 2580.1239, takeProfit: null, exitPlan: {} });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    userId = (await prisma.user.create({ data: { email: "oa@test.local", passwordHash: "x", role: "ADMIN" } })).id;
    conn = await prisma.exchangeConnection.create({
      data: { userId, provider: "oanda", exchange: "oanda", accountId: "101-001-1234567-001", label: "OANDA practice", marketType: "swap", quote: "USD", sandbox: true, apiKeyEnc: encryptSecret("tok"), secretEnc: encryptSecret(""), keyLast4: "tok", status: "OK" },
    });
  });
  beforeEach(async () => {
    fake = fakeOanda();
    setOandaFetch(fake.fetch);
    await prisma.tradingSession.deleteMany({});
    const mandate = parseMandate({ venue: "exchange", connectionId: conn.id, symbols: ["XAU/USD"], capital: 1_000, marketType: "swap", maxLeverage: 20 });
    sessionId = (await prisma.tradingSession.create({ data: { userId, name: "oa", mandate, capital: 1_000, venue: "exchange", connectionId: conn.id, endsAt: new Date(Date.now() + 3_600_000) } })).id;
  });
  afterAll(async () => { setOandaFetch(null); await prisma.$disconnect(); });

  it("market rules: USD-quoted instruments only, broker leverage cap, nothing when the market is closed", async () => {
    expect(await venue().marketRules("XAU/USD")).toMatchObject({ price: 2600.3, minQty: 1, qtyStep: 1, feeRate: 0, maxLeverage: 5 });
    expect(await venue().marketRules("EUR/JPY" as string)).toBeNull();
    fake.state.tradeable = false;
    expect(await venue().marketRules("XAU/USD")).toBeNull();
    expect(await venue().balance()).toEqual({ free: 10_000, currency: "USD" });
  });

  it("opens with whole units, OPEN_ONLY, a broker stop rounded away from the market, and records the trade", async () => {
    const r = await open();
    const post = fake.state.requests.find((q) => q.method === "POST" && q.path === "/orders")!.body as { order: Record<string, unknown> };
    expect(post.order).toMatchObject({ type: "MARKET", instrument: "XAU_USD", units: "2", timeInForce: "FOK", positionFill: "OPEN_ONLY", stopLossOnFill: { price: "2580.123", timeInForce: "GTC" } });
    expect((post.order.tradeClientExtensions as { id: string }).id).toBe(`ab-oa-${n}`);
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } });
    expect(pos).toMatchObject({ qty: 2, entryPrice: 2600.6, leverage: 5, venueTradeId: expect.any(String) });
    expect(pos.margin).toBeCloseTo(2 * 2600.6 * 0.2, 6);
    expect(await prisma.sessionOrder.count({ where: { positionId: r.positionId, purpose: "STOP", status: "OPEN" } })).toBe(1);
    expect(r.stop).toEqual({ mode: "native" });
  });

  it("a closed market cancels the entry cleanly", async () => {
    fake.state.mode = "halted";
    await expect(open()).rejects.toMatchObject({ code: "BAD_ORDER", message: expect.stringMatching(/market closed/) });
  });

  it("a timeout after the fill finds the trade; a timeout with nothing to find halts", async () => {
    fake.state.mode = "timeout-after-fill";
    const r = await open();
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } })).venueTradeId).toBe(fake.state.trades[0].id);
    expect(fake.state.trades).toHaveLength(1);
    fake.state.mode = "timeout-no-fill";
    await expect(open()).rejects.toMatchObject({ code: "UNKNOWN_ORDER" });
  });

  it("moves the broker stop, books a broker stop fill once, and closes partly then fully", async () => {
    const a = await open();
    await venue().setStop(a.positionId, 2595.5555);
    expect(fake.state.trades[0].stopLossOrder?.price).toBe("2595.555");
    fake.state.prices.XAU_USD = { bid: 2590, ask: 2590.6 };
    fake.trigger();
    const booked = await venue().syncStops!(sessionId);
    expect(booked).toHaveLength(1);
    const pa = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: a.positionId } });
    expect(pa).toMatchObject({ closeReason: "STOP_LOSS", closePrice: 2590 });
    expect(pa.realizedPnl).toBeCloseTo((2590 - 2600.6) * 2, 6);
    expect(await venue().syncStops!(sessionId)).toHaveLength(0);

    fake.state.prices.XAU_USD = { bid: 2600, ask: 2600.6 };
    const b = await open({ qty: 4, stopLoss: 2500 });
    fake.state.prices.XAU_USD = { bid: 2610, ask: 2610.6 };
    const half = await venue().closePosition({ sessionId, clientOrderId: "ab-oa-x1", positionId: b.positionId, reason: "MANUAL", fraction: 0.5 });
    expect(half).toMatchObject({ closed: false, fill: { qty: 2, price: 2610 } });
    const rest = await venue().closePosition({ sessionId, clientOrderId: "ab-oa-x2", positionId: b.positionId, reason: "MANUAL" });
    expect(rest?.closed).toBe(true);
    const pb = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: b.positionId } });
    expect(pb.realizedPnl).toBeCloseTo((2610 - 2600.6) * 4, 6);
  });

  it("reconciler: a trade closed behind our back or resized halts the session", async () => {
    const a = await open();
    const s = await prisma.tradingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect((await reconcileSession(s)).issues).toEqual([]);
    fake.state.trades[0].currentUnits = "1";
    const r = await reconcileSession(s);
    expect(r.issues[0]).toMatch(/1 units at OANDA vs 2/);
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("HALTED");
    void a;
  });

  it("a cycle skips the AI while every session market is closed", async () => {
    const { runCycle } = await import("@/lib/sessions/cycle");
    fake.state.tradeable = false;
    let aiCalls = 0;
    const ai = (async () => { aiCalls++; throw new Error("should not be called"); }) as never;
    const gather = async (symbol: string) => ({ symbol, price: 2600, changePct24h: 0, timeframes: [], consensus: null, funding: null, news: [] });
    const r = await runCycle(sessionId, { ai, gather, telegram: null, force: true });
    expect(r.skipped).toBe("markets closed");
    expect(aiCalls).toBe(0);
  });

  it("session start: forex and metals only, balance from the broker", async () => {
    process.env.LIVE_TRADING_ENABLED = "1";
    await expect(startSession(userId, { mandate: { venue: "exchange", connectionId: conn.id, symbols: ["BTC/USDT"], capital: 100, marketType: "swap", maxLeverage: 5 } }))
      .rejects.toMatchObject({ code: "BAD_SYMBOL" });
    const s = await startSession(userId, { mandate: { venue: "exchange", connectionId: conn.id, symbols: ["XAU/USD", "EUR/USD"], capital: 500, marketType: "swap", maxLeverage: 20 } });
    expect(s).toMatchObject({ venue: "exchange", live: false });
    delete process.env.LIVE_TRADING_ENABLED;
  });
});
