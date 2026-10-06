/** Exchange sessions end to end against Postgres with a fake ccxt exchange. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AiRequest } from "@/lib/ai";
import type { AiFn } from "@/lib/agents/run";
import type { SymbolContext } from "@/lib/agents/context";
import { encryptSecret } from "@/lib/secrets/crypto";
import { setExchangeFactory } from "@/lib/venues/ccxtClient";
import { startSession } from "@/lib/sessions/service";
import { runCycle } from "@/lib/sessions/cycle";
import { monitorSessions } from "@/lib/sessions/monitor";
import { reconcileSession } from "@/lib/exec/reconciler";
import { listMessages } from "@/lib/sessions/room";
import { fakeExchange } from "../setup/fakeExchange";

const run = !!process.env.TEST_DATABASE_URL;
process.env.EXCHANGE_KEY_SECRET = randomBytes(32).toString("base64");

const plan = { commentary: "go", decisions: [{ action: "OPEN_LONG", symbol: "BTC/USDT", positionId: null, conviction: 0.7, thesis: "t", stopLoss: 95_000, takeProfit: 120_000, invalidation: "i", horizonMin: 60 }] };
const note = { notes: [] };
const lesson = { outcome: "LOSS", rootCause: "r", mistakes: [], strengths: [], lesson: "l", tags: [] };
const ai = (async (req: AiRequest<never>) => ({
  data: (req.schema as unknown as { parse(v: unknown): unknown }).parse(req.feature === "session.strategist" ? plan : req.feature === "session.journal" ? lesson : req.feature === "session.report" ? { summary: "s", lessons: [] } : note),
  meta: { provider: "openai", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.001, visionFallback: false },
})) as unknown as AiFn;
const gather = async (symbol: string): Promise<SymbolContext> => ({ symbol, price: 100_000, changePct24h: 0, timeframes: [{ timeframe: "1H", available: true, trend: "Bullish", stretch: "Neutral", rsi: 55, atr: 1_000, macd: "Bullish", ema: "Above" }], consensus: null, funding: null, news: [] });

describe.skipIf(!run)("exchange sessions (Postgres, fake exchange)", () => {
  let admin: string, user: string, connId: string;
  let fake: ReturnType<typeof fakeExchange>;
  const mandate = () => ({ venue: "exchange", connectionId: connId, symbols: ["BTC/USDT"], capital: 500, durationMin: 60 });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    admin = (await prisma.user.create({ data: { email: "ex-admin@test.local", passwordHash: "x", role: "ADMIN" } })).id;
    user = (await prisma.user.create({ data: { email: "ex-user@test.local", passwordHash: "x" } })).id;
    connId = (await prisma.exchangeConnection.create({
      data: { userId: admin, exchange: "binance", label: "Binance testnet", sandbox: true, apiKeyEnc: encryptSecret("k"), secretEnc: encryptSecret("s"), keyLast4: "k", status: "OK" },
    })).id;
  });
  beforeEach(async () => {
    process.env.LIVE_TRADING_ENABLED = "1";
    fake = fakeExchange();
    setExchangeFactory(async () => fake.ex);
    await prisma.tradingSession.deleteMany({});
  });
  afterAll(async () => {
    delete process.env.LIVE_TRADING_ENABLED;
    setExchangeFactory(null);
    await prisma.$disconnect();
  });

  it("gating: env flag, admin only, healthy connection, real money needs LIVE, enough balance", async () => {
    delete process.env.LIVE_TRADING_ENABLED;
    await expect(startSession(admin, { mandate: mandate() })).rejects.toMatchObject({ status: 403 });
    process.env.LIVE_TRADING_ENABLED = "1";
    await expect(startSession(user, { mandate: mandate() })).rejects.toMatchObject({ status: 403 });
    await expect(startSession(admin, { mandate: { ...mandate(), capital: 5_000 } })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(startSession(admin, { mandate: { ...mandate(), symbols: ["XAU/USD"] } })).rejects.toMatchObject({ code: "BAD_SYMBOL" });
    await prisma.exchangeConnection.update({ where: { id: connId }, data: { sandbox: false } });
    await expect(startSession(admin, { mandate: mandate() })).rejects.toMatchObject({ code: "CONFIRM_LIVE" });
    const live = await startSession(admin, { mandate: mandate(), confirmLive: "LIVE" });
    expect(live.live).toBe(true);
    await prisma.exchangeConnection.update({ where: { id: connId }, data: { sandbox: true, status: "ERROR" } });
    await expect(startSession(admin, { mandate: mandate() })).rejects.toMatchObject({ code: "BAD_CONNECTION" });
    await prisma.exchangeConnection.update({ where: { id: connId }, data: { status: "OK" } });
  });

  it("a testnet session trades through the exchange, stops on the exchange price, and reconciles", async () => {
    const s = await startSession(admin, { mandate: mandate() });
    expect(s).toMatchObject({ venue: "exchange", connectionId: connId, live: false, startPrices: { "BTC/USDT": 100_000 } });
    const r = await runCycle(s.id, { ai, gather, telegram: null });
    expect(r.executed).toBe(1);
    expect(fake.state.calls).toBe(1);
    const pos = await prisma.sessionPosition.findFirstOrThrow({ where: { sessionId: s.id } });
    expect(pos.entryPrice).toBe(100_000);

    expect((await reconcileSession(s)).issues).toEqual([]);

    fake.state.price = 94_000;
    await monitorSessions({ ai, telegram: null, awaitBackground: true, cycles: false });
    const closed = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: pos.id } });
    expect(closed.closeReason).toBe("STOP_LOSS");
    expect(closed.closePrice).toBe(94_000);
    expect(fake.state.calls).toBe(2);
  });

  it("a balance that no longer covers the position halts the session", async () => {
    const s = await startSession(admin, { mandate: mandate() });
    await runCycle(s.id, { ai, gather, telegram: null });
    fake.state.balance.BTC = 0; // sold by hand on the exchange
    const r = await reconcileSession(s);
    expect(r.issues[0]).toMatch(/balance/);
    const after = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(after).toMatchObject({ status: "HALTED", endReason: "RECONCILE_MISMATCH" });
    expect((await listMessages(admin, s.id)).some((m) => /halted/i.test(m.body))).toBe(true);
  });

  it("an entry whose outcome stays unknown halts the session instead of retrying", async () => {
    const s = await startSession(admin, { mandate: mandate() });
    fake.state.mode = "timeout-missing";
    await runCycle(s.id, { ai, gather, telegram: null });
    expect(fake.state.calls).toBe(1);
    const after = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(after).toMatchObject({ status: "HALTED", endReason: "RECONCILE_MISMATCH" });
  });
});
