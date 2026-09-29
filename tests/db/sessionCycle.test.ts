/** Decision cycle against Postgres with a stub AI and stub market data. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { AiRequest } from "@/lib/ai";
import { AiError } from "@/lib/ai/errors";
import type { SymbolContext } from "@/lib/agents/context";
import type { AiFn } from "@/lib/agents/run";
import { runCycle } from "@/lib/sessions/cycle";
import { startSession } from "@/lib/sessions/service";
import { listMessages } from "@/lib/sessions/room";

const run = !!process.env.TEST_DATABASE_URL;
const prices: Record<string, number | null> = { "BTC/USDT": 100, "ETH/USDT": 10 };
const priceOf = async (s: string) => prices[s] ?? null;
const gather = async (symbol: string): Promise<SymbolContext> => ({
  symbol, price: prices[symbol] ?? null, changePct24h: 1, consensus: null, funding: null, news: [],
  timeframes: [{ timeframe: "1H", available: true, trend: "Bullish", stretch: "Neutral", rsi: 55, atr: 1, macd: "Bullish", ema: "Above" }],
});

type Plan = { decisions: unknown[]; commentary: string };
let plan: Plan = { decisions: [], commentary: "" };
let fail: Error | null = null;
const calls: string[] = [];
const note = { notes: [{ symbol: "BTC/USDT", stance: "bullish", confidence: 0.6, summary: "up", keyPoints: [] }] };
const ai = (async (req: AiRequest<never>) => {
  calls.push(req.feature);
  if (fail) throw fail;
  const raw = req.feature === "session.strategist" ? plan : req.feature === "session.debate" ? { bull: "b", bear: "c" } : note;
  return { data: (req.schema as unknown as { parse(v: unknown): unknown }).parse(raw), meta: { provider: "openai", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.01, visionFallback: false } };
}) as unknown as AiFn;

const decision = (o: Record<string, unknown>) => ({ symbol: "BTC/USDT", positionId: null, conviction: 0.7, thesis: "trend", stopLoss: 95, takeProfit: 110, invalidation: "below 94", horizonMin: 240, action: "OPEN_LONG", ...o });
const deps = { ai, priceOf, gather, telegram: null };

describe.skipIf(!run)("decision cycle (Postgres)", () => {
  let U: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    U = (await prisma.user.create({ data: { email: "cy@test.local", passwordHash: "x" } })).id;
  });
  beforeEach(async () => {
    await prisma.tradingSession.deleteMany({});
    prices["BTC/USDT"] = 100;
    fail = null;
    calls.length = 0;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const start = (o: Record<string, unknown> = {}) => startSession(U, { mandate: { symbols: ["BTC/USDT", "ETH/USDT"], capital: 1_000, ...o } }, { priceOf, telegram: null });

  it("an approved long opens a position sized by the risk engine and everything lands in the room", async () => {
    const s = await start();
    plan = { commentary: "BTC breaking out", decisions: [decision({})] };
    const r = await runCycle(s.id, deps);
    expect(r).toMatchObject({ ran: true, decisions: 1, executed: 1 });
    const pos = await prisma.sessionPosition.findFirstOrThrow({ where: { sessionId: s.id } });
    // 1% of 1000 = $10 over a $5 stop = 2 BTC... capped at 50% of capital = $500 → 5 units; risk size 2 wins.
    expect(pos.qty).toBeCloseTo(2, 8);
    expect(pos.exitPlan).toMatchObject({ thesis: "trend", invalidation: "below 94", initialStop: 95 });
    const roles = (await listMessages(U, s.id)).map((m) => `${m.role}:${m.kind}`);
    expect(roles).toEqual(expect.arrayContaining(["MARKET:TEXT", "NEWS:TEXT", "STRATEGIST:TEXT", "STRATEGIST:PROPOSAL", "RISK:VERDICT", "EXECUTOR:FILL"]));
    const after = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(after).toMatchObject({ cycleCount: 1, tradesCount: 1 });
    expect(after.llmCostUsd).toBeCloseTo(0.03, 10);
    expect(after.nextCycleAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
  });

  it("a rejected proposal posts the reasons and places no order", async () => {
    const s = await start();
    plan = { commentary: "short it", decisions: [decision({ action: "OPEN_SHORT", stopLoss: 105, takeProfit: 90 })] };
    await runCycle(s.id, deps);
    expect(await prisma.sessionOrder.count({ where: { sessionId: s.id } })).toBe(0);
    const verdict = (await listMessages(U, s.id)).find((m) => m.kind === "VERDICT");
    expect(verdict?.body).toMatch(/spot/);
  });

  it("is not due before the interval, and runs early on a big move", async () => {
    const s = await start();
    plan = { commentary: "hold", decisions: [] };
    expect((await runCycle(s.id, deps)).ran).toBe(true);
    expect((await runCycle(s.id, deps)).skipped).toBe("not due");
    prices["BTC/USDT"] = 102;
    expect((await runCycle(s.id, deps)).ran).toBe(true);
  });

  it("skips the AI on a quiet interval with no positions after an all-hold cycle", async () => {
    const s = await start();
    plan = { commentary: "hold", decisions: [] };
    await runCycle(s.id, deps);
    calls.length = 0;
    const r = await runCycle(s.id, { ...deps, now: new Date(Date.now() + 31 * 60_000) });
    expect(r.skipped).toBe("quiet");
    expect(calls).toHaveLength(0);
  });

  it("stops cycling when the AI budget is used, and pauses after repeated agent failures", async () => {
    const s = await start({ maxLlmCostUsd: 0.05 });
    plan = { commentary: "hold", decisions: [] };
    await runCycle(s.id, { ...deps, force: true });
    await runCycle(s.id, { ...deps, force: true });
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).llmBudgetHit).toBe(true);
    expect((await runCycle(s.id, { ...deps, force: true })).skipped).toBe("ai budget used");

    const t = await start();
    fail = new AiError("AI_UPSTREAM", "down");
    for (let i = 0; i < 3; i++) await runCycle(t.id, { ...deps, force: true });
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("PAUSED");
  });

  it("closes and tightens open positions on the strategist's call", async () => {
    const s = await start();
    plan = { commentary: "go", decisions: [decision({})] };
    await runCycle(s.id, deps);
    const pos = await prisma.sessionPosition.findFirstOrThrow({ where: { sessionId: s.id } });
    prices["BTC/USDT"] = 104;
    plan = { commentary: "protect", decisions: [decision({ action: "TIGHTEN_STOP", positionId: pos.id, stopLoss: 101 })] };
    await runCycle(s.id, { ...deps, force: true });
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: pos.id } })).stopLoss).toBe(101);
    plan = { commentary: "done", decisions: [decision({ action: "CLOSE", positionId: pos.id })] };
    await runCycle(s.id, { ...deps, force: true });
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: pos.id } })).closeReason).toBe("STRATEGIST");
  });

  it("does not open new trades in the last minutes of the session", async () => {
    const s = await start({ durationMin: 30 });
    plan = { commentary: "go", decisions: [decision({})] };
    await runCycle(s.id, { ...deps, now: new Date(s.endsAt.getTime() - 2 * 60_000), force: true });
    expect(await prisma.sessionPosition.count({ where: { sessionId: s.id } })).toBe(0);
  });
});
