/** Native exchange stops (P8c) against Postgres with a fake exchange. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secrets/crypto";
import { parseMandate } from "@/lib/sessions/mandate";
import { ccxtVenue } from "@/lib/venues/ccxt";
import { setExchangeFactory } from "@/lib/venues/ccxtClient";
import { monitorSessions } from "@/lib/sessions/monitor";
import { reconcileSession } from "@/lib/exec/reconciler";
import { listMessages } from "@/lib/sessions/room";
import type { AiFn } from "@/lib/agents/run";
import type { AiRequest } from "@/lib/ai";
import { fakeExchange } from "../setup/fakeExchange";

const run = !!process.env.TEST_DATABASE_URL;
process.env.EXCHANGE_KEY_SECRET = randomBytes(32).toString("base64");
const lesson = { outcome: "LOSS", rootCause: "r", mistakes: [], strengths: [], lesson: "l", tags: [] };
const ai = (async (req: AiRequest<never>) => ({
  data: (req.schema as unknown as { parse(v: unknown): unknown }).parse(req.feature === "session.journal" ? lesson : { summary: "s", lessons: [] }),
  meta: { provider: "openai", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0, visionFallback: false },
})) as unknown as AiFn;

describe.skipIf(!run)("native exchange stops (Postgres, fake exchange)", () => {
  let userId: string, sessionId: string;
  let conn: Awaited<ReturnType<typeof prisma.exchangeConnection.create>>;
  let fake: ReturnType<typeof fakeExchange>;
  const venue = () => ccxtVenue(conn, { sleep: async () => undefined, lookupTries: 1 });
  let n = 0;
  const open = (stopLoss = 95_000) => venue().openPosition({ sessionId, clientOrderId: `ns-${++n}`, symbol: "BTC/USDT", side: "LONG", qty: 0.001, leverage: 1, stopLoss, takeProfit: null, exitPlan: { thesis: "t" } });
  const stops = () => prisma.sessionOrder.findMany({ where: { sessionId, purpose: "STOP", type: "stop_market" }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    userId = (await prisma.user.create({ data: { email: "ns@test.local", passwordHash: "x", role: "ADMIN" } })).id;
    conn = await prisma.exchangeConnection.create({ data: { userId, exchange: "binance", label: "t", sandbox: true, apiKeyEnc: encryptSecret("k"), secretEnc: encryptSecret("s"), keyLast4: "k", status: "OK" } });
  });
  beforeEach(async () => {
    fake = fakeExchange({ nativeStops: true });
    setExchangeFactory(async () => fake.ex);
    await prisma.tradingSession.deleteMany({});
    const mandate = parseMandate({ venue: "exchange", connectionId: conn.id, symbols: ["BTC/USDT"], capital: 500 });
    sessionId = (await prisma.tradingSession.create({ data: { userId, name: "ns", mandate, capital: 500, venue: "exchange", connectionId: conn.id, endsAt: new Date(Date.now() + 3_600_000) } })).id;
  });
  afterAll(async () => { setExchangeFactory(null); await prisma.$disconnect(); });

  it("places a stop order on the exchange after the entry fills", async () => {
    expect(await venue().stopMode("BTC/USDT")).toBe("native");
    const r = await open();
    expect(r.stop).toEqual({ mode: "native" });
    const [s] = await stops();
    expect(s).toMatchObject({ status: "OPEN", price: 95_000, side: "SELL", reduceOnly: true, positionId: r.positionId });
    expect(s.amount).toBeCloseTo(0.00099, 10); // held after the base-asset fee, floored to the step
    expect(fake.state.orders.find((o) => o.id === s.venueOrderId)?.stopLossPrice).toBe(95_000);
  });

  it("moving the stop cancels the old order and rests a new one", async () => {
    const r = await open();
    expect(await venue().setStop(r.positionId, 97_000)).toBeNull();
    const [old, fresh] = await stops();
    expect(old.status).toBe("CANCELED");
    expect(fresh).toMatchObject({ status: "OPEN", price: 97_000 });
    expect(fake.state.orders.filter((o) => o.status === "open")).toHaveLength(1);
  });

  it("a market close cancels the stop first", async () => {
    const r = await open();
    const c = await venue().closePosition({ sessionId, clientOrderId: "ns-x1", positionId: r.positionId, reason: "MANUAL" });
    expect(c?.closed).toBe(true);
    expect((await stops())[0].status).toBe("CANCELED");
    expect(fake.state.orders.filter((o) => o.status === "open")).toHaveLength(0);
  });

  it("a stop that fired on the exchange is booked once, and never sold again", async () => {
    const r = await open();
    fake.state.price = 94_000;
    fake.trigger();
    const booked = await venue().syncStops!(sessionId);
    expect(booked).toHaveLength(1);
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } });
    expect(pos).toMatchObject({ closeReason: "STOP_LOSS", closePrice: 94_000 });
    expect(await venue().syncStops!(sessionId)).toHaveLength(0);
    expect(fake.state.calls).toBe(1); // only the entry was a market order
  });

  it("a close that races a filled stop books the stop and sends nothing", async () => {
    const r = await open();
    fake.state.price = 94_000;
    fake.trigger();
    const c = await venue().closePosition({ sessionId, clientOrderId: "ns-x2", positionId: r.positionId, reason: "KILL" });
    expect(c?.closed).toBe(true);
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } })).closeReason).toBe("STOP_LOSS");
    expect(fake.state.calls).toBe(1);
  });

  it("after a partial close the stop covers what is left", async () => {
    const r = await open();
    fake.state.price = 101_000;
    await venue().closePosition({ sessionId, clientOrderId: "ns-x3", positionId: r.positionId, reason: "MANUAL", fraction: 0.5 });
    const all = await stops();
    expect(all[0].status).toBe("CANCELED");
    expect(all[1]).toMatchObject({ status: "OPEN", price: 95_000 });
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: r.positionId } });
    expect(all[1].amount).toBeLessThanOrEqual(pos.qty + 1e-12);
  });

  it("venues without native stops keep software stops", async () => {
    fake = fakeExchange({ nativeStops: false });
    setExchangeFactory(async () => fake.ex);
    const r = await open();
    expect(r.stop).toEqual({ mode: "software" });
    expect(await stops()).toHaveLength(0);
  });

  it("monitor: gives the exchange stop room, books its fill, and falls back to software when it does not fire", async () => {
    const a = await open();
    fake.state.price = 94_900; // just through the 95,000 stop but inside the slack
    await monitorSessions({ ai, telegram: null, awaitBackground: true, cycles: false });
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: a.positionId } })).closedAt).toBeNull();
    fake.trigger();
    await monitorSessions({ ai, telegram: null, awaitBackground: true, cycles: false });
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: a.positionId } })).closeReason).toBe("STOP_LOSS");
    expect((await listMessages(userId, sessionId)).some((m) => /filled on the exchange/.test(m.body))).toBe(true);

    fake.state.price = 100_000;
    const b = await open();
    fake.state.price = 90_000; // far through the stop, and the exchange stop does not fire
    await monitorSessions({ ai, telegram: null, awaitBackground: true, cycles: false });
    const closed = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: b.positionId } });
    expect(closed.closeReason).toBe("STOP_LOSS");
    expect(fake.state.orders.filter((o) => o.status === "open")).toHaveLength(0);
  });

  it("the reconciler accepts the stops the ledger placed", async () => {
    await open();
    const s = await prisma.tradingSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect((await reconcileSession(s)).issues).toEqual([]);
  });
});
