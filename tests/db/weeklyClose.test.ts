/** P10: nothing on a weekday-only market (FX, metals) is opened near, or held into, the Friday close. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { AiRequest } from "@/lib/ai";
import type { AiFn } from "@/lib/agents/run";
import { monitorSessions } from "@/lib/sessions/monitor";
import { startSession } from "@/lib/sessions/service";
import { paperVenue } from "@/lib/venues/paper";

const run = !!process.env.TEST_DATABASE_URL;
const prices: Record<string, number | null> = { "EUR/USD": 1.1, "BTC/USDT": 100 };
const priceOf = async (s: string) => prices[s] ?? null;
const ai = (async (req: AiRequest<never>) => {
  const raw = req.feature === "session.journal"
    ? { outcome: "BREAKEVEN", rootCause: "closed for the weekend", mistakes: [], strengths: [], lesson: "mind the clock", tags: [] }
    : { summary: "closed before the weekend", lessons: [] };
  return { data: (req.schema as unknown as { parse(v: unknown): unknown }).parse(raw), meta: { provider: "openai", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0, visionFallback: false } };
}) as unknown as AiFn;

// Friday 2026-10-02: 14:00 New York (3 h before the close) and 16:45 New York (15 min before it).
const FRI_EARLY = new Date("2026-10-02T18:00:00Z");
const FRI_LATE = new Date("2026-10-02T20:45:00Z");

describe.skipIf(!run)("weekly market close (Postgres)", () => {
  let U: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    U = (await prisma.user.create({ data: { email: "close@test.local", passwordHash: "x" } })).id;
  });
  beforeEach(async () => { await prisma.tradingSession.deleteMany({}); });
  afterAll(async () => { await prisma.$disconnect(); });

  const start = (symbols: string[], now: Date, o: Record<string, unknown> = {}) =>
    startSession(U, { mandate: { symbols, capital: 1_000, durationMin: 480, marketType: "swap", maxLeverage: 20, ...o } }, { priceOf, telegram: null, now });
  const openEur = (sessionId: string) => paperVenue(priceOf).openPosition({
    sessionId, clientOrderId: `o-${Math.random()}`, symbol: "EUR/USD", side: "LONG", qty: 100, leverage: 20, stopLoss: 1.09, takeProfit: 1.12,
    exitPlan: { thesis: "t", invalidation: "i", horizonMin: 180, initialStop: 1.09 },
  });
  const monitor = (now: Date) => monitorSessions({ priceOf, ai, telegram: null, awaitBackground: true, cycles: false, now });

  it("refuses to start an FX session in the last hour before the close or over the weekend", async () => {
    await expect(start(["EUR/USD"], new Date("2026-10-02T20:30:00Z"))).rejects.toThrow(/close for the weekend in 30 min/);
    await expect(start(["EUR/USD"], new Date("2026-10-03T12:00:00Z"))).rejects.toThrow(/closed for the weekend/);
    await expect(start(["BTC/USDT"], new Date("2026-10-03T12:00:00Z"))).resolves.toBeTruthy();
  });

  it("closes FX positions and ends an all-FX session 20 min before the close", async () => {
    const s = await start(["EUR/USD"], FRI_EARLY);
    const { positionId } = await openEur(s.id);
    expect((await monitor(FRI_EARLY)).exits).toEqual([]);
    const r = await monitor(FRI_LATE);
    expect(r.exits).toEqual([{ positionId, reason: "MARKET_CLOSE" }]);
    expect(r.ended).toContain(s.id);
    const after = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id }, include: { positions: true } });
    expect(after).toMatchObject({ status: "ENDED", endReason: "MARKET_CLOSE" });
    expect(after.positions[0].closeReason).toBe("MARKET_CLOSE");
  });

  it("a mixed crypto + FX session closes the FX leg and keeps running", async () => {
    const s = await start(["EUR/USD", "BTC/USDT"], FRI_EARLY);
    await openEur(s.id);
    const r = await monitor(FRI_LATE);
    expect(r.exits.map((e) => e.reason)).toEqual(["MARKET_CLOSE"]);
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("RUNNING");
  });

  it("keep-with-stops warns once instead of closing", async () => {
    const s = await start(["EUR/USD", "BTC/USDT"], FRI_EARLY, { onEnd: "KEEP_WITH_STOPS" });
    await openEur(s.id);
    await monitor(FRI_LATE);
    await monitor(new Date(FRI_LATE.getTime() + 15_000));
    expect(await prisma.sessionPosition.count({ where: { sessionId: s.id, closedAt: null } })).toBe(1);
    expect(await prisma.sessionMessage.count({ where: { sessionId: s.id, body: { startsWith: "Weekly close" } } })).toBe(1);
  });
});
