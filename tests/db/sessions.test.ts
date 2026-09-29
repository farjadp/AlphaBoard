/** Session service against Postgres: start rules, transitions, ownership, manual exits, kill and end. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  closeSessionPosition, endSession, extendSession, killSession, listSessions, moveStopToBreakeven, pauseSession, resumeSession,
  sessionView, startSession,
} from "@/lib/sessions/service";
import { setLimits, dailyUsage } from "@/lib/sessions/limits";
import { listMessages } from "@/lib/sessions/room";
import { paperVenue } from "@/lib/venues/paper";

const run = !!process.env.TEST_DATABASE_URL;
const prices: Record<string, number | null> = { "BTC/USDT": 100, "ETH/USDT": 10 };
const priceOf = async (s: string) => prices[s] ?? null;
const deps = { priceOf, telegram: null };
const mandate = { symbols: ["BTC/USDT", "ETH/USDT"], capital: 1_000, durationMin: 60 };

async function openOn(sessionId: string, symbol = "BTC/USDT", qty = 2) {
  return paperVenue(priceOf).openPosition({ sessionId, clientOrderId: `t-${Math.random()}`, symbol, side: "LONG", qty, leverage: 1, stopLoss: 90, takeProfit: 120, exitPlan: { thesis: "t", invalidation: "i", horizonMin: 60 } });
}

describe.skipIf(!run)("session service (Postgres)", () => {
  let A: string, B: string;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "sa@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "sb@test.local", passwordHash: "x" } })).id;
  });
  beforeEach(async () => {
    await prisma.tradingSession.deleteMany({});
    await prisma.userTradingLimits.deleteMany({});
    prices["BTC/USDT"] = 100;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("starts a paper session with defaults, start prices and a room message", async () => {
    const now = new Date("2026-09-28T10:00:00Z");
    const s = await startSession(A, { mandate }, { ...deps, now });
    expect(s).toMatchObject({ status: "RUNNING", capital: 1_000, venue: "paper", live: false });
    expect(s.endsAt.toISOString()).toBe("2026-09-28T11:00:00.000Z");
    expect(s.startPrices).toEqual({ "BTC/USDT": 100, "ETH/USDT": 10 });
    const msgs = await listMessages(A, s.id);
    expect(msgs[0]).toMatchObject({ role: "SYSTEM" });
    expect((await listSessions(A))[0]).toMatchObject({ id: s.id, symbols: ["BTC/USDT", "ETH/USDT"], openPositions: 0 });
  });

  it("refuses bad mandates, live mode and too many sessions", async () => {
    await expect(startSession(A, { mandate: { ...mandate, maxLeverage: 3 } }, deps)).rejects.toMatchObject({ status: 400, code: "BAD_MANDATE" });
    await expect(startSession(A, { mandate, live: true }, deps)).rejects.toMatchObject({ code: "LIVE_DISABLED" });
    for (let i = 0; i < 3; i++) await startSession(A, { mandate }, deps);
    await expect(startSession(A, { mandate }, deps)).rejects.toMatchObject({ code: "TOO_MANY_SESSIONS" });
  });

  it("enforces daily limits", async () => {
    await setLimits(A, { maxDailyLoss: null, maxSessionsPerDay: 1 });
    await startSession(A, { mandate }, deps);
    await expect(startSession(A, { mandate }, deps)).rejects.toMatchObject({ code: "DAILY_LIMIT" });
    expect((await dailyUsage(A)).sessionsToday).toBe(1);
  });

  it("pause → resume → extend, and ownership is enforced", async () => {
    const s = await startSession(A, { mandate }, deps);
    await expect(pauseSession(B, s.id, deps)).rejects.toMatchObject({ status: 404 });
    await pauseSession(A, s.id, deps);
    await expect(pauseSession(A, s.id, deps)).rejects.toMatchObject({ code: "BAD_STATE" });
    await resumeSession(A, s.id, deps);
    const endsAt = await extendSession(A, s.id, 60, deps);
    expect(endsAt.getTime()).toBe(s.endsAt.getTime() + 3_600_000);
    await expect(extendSession(A, s.id, 1, deps)).rejects.toMatchObject({ code: "BAD_EXTENSION" });
    await expect(sessionView(B, s.id, deps)).rejects.toMatchObject({ status: 404 });
  });

  it("an extension answers the end prompt and restarts the session", async () => {
    const s = await startSession(A, { mandate }, deps);
    await prisma.tradingSession.update({ where: { id: s.id }, data: { status: "AWAITING_EXTENSION", extensionPromptAt: new Date() } });
    await extendSession(A, s.id, 120, deps);
    const after = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe("RUNNING");
    expect(after.extensionPromptAt).toBeNull();
  });

  it("view marks open positions, and a missing price makes equity unavailable", async () => {
    const s = await startSession(A, { mandate }, deps);
    await openOn(s.id);
    prices["BTC/USDT"] = 110;
    const v = await sessionView(A, s.id, deps);
    expect(v.positions[0].markPrice).toBe(110);
    expect(v.unrealizedPnl).toBeGreaterThan(19);
    expect(v.meters.lossUsed).toBe(0);
    prices["BTC/USDT"] = null;
    const u = await sessionView(A, s.id, deps);
    expect(u.equity).toBeNull();
    expect(u.positions[0].unrealizedPnl).toBeNull();
  });

  it("manual partial close, breakeven stop, then full close", async () => {
    const s = await startSession(A, { mandate }, deps);
    const { positionId } = await openOn(s.id);
    prices["BTC/USDT"] = 110;
    await closeSessionPosition(A, positionId, 0.5, deps);
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: positionId } })).qty).toBeCloseTo(1, 10);
    await moveStopToBreakeven(A, positionId, deps);
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(pos.stopLoss).toBe(pos.entryPrice);
    await expect(moveStopToBreakeven(A, positionId, deps)).rejects.toMatchObject({ code: "ALREADY_PROTECTED" });
    await expect(closeSessionPosition(B, positionId, 1, deps)).rejects.toMatchObject({ status: 404 });
    await closeSessionPosition(A, positionId, 1, deps);
    await expect(closeSessionPosition(A, positionId, 1, deps)).rejects.toMatchObject({ code: "CLOSED" });
    const body = (await listMessages(A, s.id)).map((m) => m.body).join("\n");
    expect(body).toMatch(/Closed 50% of LONG BTC\/USDT/);
    expect(body).toMatch(/breakeven/);
  });

  it("kill halts and flattens; end with stops keeps positions", async () => {
    const s1 = await startSession(A, { mandate }, deps);
    await openOn(s1.id);
    await killSession(A, s1.id, deps);
    const k = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s1.id } });
    expect(k).toMatchObject({ status: "HALTED", endReason: "KILL" });
    expect(await prisma.sessionPosition.count({ where: { sessionId: s1.id, closedAt: null } })).toBe(0);

    const s2 = await startSession(A, { mandate }, deps);
    await openOn(s2.id);
    await endSession(A, s2.id, "KEEP_WITH_STOPS", deps);
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: s2.id } })).status).toBe("ENDED");
    expect(await prisma.sessionPosition.count({ where: { sessionId: s2.id, closedAt: null } })).toBe(1);
    await expect(endSession(A, s2.id, "CLOSE_ALL", deps)).rejects.toMatchObject({ code: "BAD_STATE" });
    await killSession(A, s2.id, deps);
    expect(await prisma.sessionPosition.count({ where: { sessionId: s2.id, closedAt: null } })).toBe(0);
  });
});
