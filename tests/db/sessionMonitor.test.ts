/** Session monitor against Postgres: stops, loss limit, end prompt + timeout, journal and report. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { AiRequest } from "@/lib/ai";
import type { AiFn } from "@/lib/agents/run";
import { exitFor, monitorSessions } from "@/lib/sessions/monitor";
import { startSession, endSession } from "@/lib/sessions/service";
import { listMessages } from "@/lib/sessions/room";
import { paperVenue } from "@/lib/venues/paper";
import type { Telegram } from "@/lib/notify/telegram";

const run = !!process.env.TEST_DATABASE_URL;
const prices: Record<string, number | null> = { "BTC/USDT": 100 };
const priceOf = async (s: string) => prices[s] ?? null;
const journalInputs: string[] = [];
const ai = (async (req: AiRequest<never>) => {
  if (req.feature === "session.journal") journalInputs.push(String(req.user));
  const raw = req.feature === "session.journal"
    ? { outcome: "LOSS", rootCause: "stopped", mistakes: ["late"], strengths: [], lesson: "wait for the retest", tags: ["stop"] }
    : { summary: "one losing trade", lessons: ["be patient"] };
  return { data: (req.schema as unknown as { parse(v: unknown): unknown }).parse(raw), meta: { provider: "openai", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.001, visionFallback: false } };
}) as unknown as AiFn;

function fakeBot() {
  const sent: Array<{ chatId: string; text: string; keyboard?: unknown }> = [];
  const edits: string[] = [];
  const bot: Telegram = {
    username: async () => "Bot",
    updates: async () => [],
    send: async (chatId, text, keyboard) => { sent.push({ chatId, text, keyboard }); return 77; },
    edit: async (_c, _m, text) => { edits.push(text); },
    answer: async () => undefined,
  };
  return { bot, sent, edits };
}

const deps = (o: Record<string, unknown> = {}) => ({ priceOf, ai, telegram: null, awaitBackground: true, cycles: false, ...o });

describe("exitFor", () => {
  const p = { side: "LONG" as const, leverage: 1, entryPrice: 100, stopLoss: 95, takeProfit: 110 };
  it("stop, target and liquidation", () => {
    expect(exitFor(p, 96)).toBeNull();
    expect(exitFor(p, 95)).toBe("STOP_LOSS");
    expect(exitFor(p, 111)).toBe("TAKE_PROFIT");
    expect(exitFor({ ...p, side: "SHORT", stopLoss: 105, takeProfit: 90 }, 106)).toBe("STOP_LOSS");
    expect(exitFor({ ...p, leverage: 10, stopLoss: null }, 89)).toBe("LIQUIDATION");
  });
});

describe.skipIf(!run)("session monitor (Postgres)", () => {
  let U: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    U = (await prisma.user.create({ data: { email: "mon@test.local", passwordHash: "x", telegramChatId: "555" } })).id;
  });
  beforeEach(async () => {
    await prisma.tradingSession.deleteMany({});
    prices["BTC/USDT"] = 100;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const start = (o: Record<string, unknown> = {}) => startSession(U, { mandate: { symbols: ["BTC/USDT"], capital: 1_000, durationMin: 60, ...o } }, { priceOf, telegram: null });
  const open = (sessionId: string, qty = 2, stopLoss = 95) =>
    paperVenue(priceOf).openPosition({ sessionId, clientOrderId: `o-${Math.random()}`, symbol: "BTC/USDT", side: "LONG", qty, leverage: 1, stopLoss, takeProfit: 120, exitPlan: { thesis: "t", invalidation: "i", horizonMin: 60, initialStop: stopLoss } });

  it("records the best and worst price while open and hands them to the journal in R", async () => {
    const s = await start();
    const { positionId } = await open(s.id); // entry ≈ 100, stop 95 → R ≈ 5
    prices["BTC/USDT"] = 103;
    await monitorSessions(deps());
    prices["BTC/USDT"] = 98;
    await monitorSessions(deps());
    const mid = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(mid).toMatchObject({ bestPrice: 103, worstPrice: 98 });
    journalInputs.length = 0;
    prices["BTC/USDT"] = 94;
    await monitorSessions(deps());
    expect(journalInputs.join("\n")).toMatch(/Best move in favour 0\.\d\dR, worst move against 1\.\d\dR/);
  });

  it("closes on the stop, journals the trade with a lesson", async () => {
    const s = await start();
    const { positionId } = await open(s.id);
    prices["BTC/USDT"] = 94;
    const r = await monitorSessions(deps());
    expect(r.exits).toEqual([{ positionId, reason: "STOP_LOSS" }]);
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(pos.journalEntryId).not.toBeNull();
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: pos.journalEntryId! }, include: { lesson: true } });
    expect(entry).toMatchObject({ pnlSource: "SESSION", status: "CLOSED", position: "LONG", sessionPositionId: positionId });
    expect(entry.lesson?.lesson).toBe("wait for the retest");
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("RUNNING");
  });

  it("halts on the loss limit (unrealized counts) and flattens", async () => {
    const s = await start({ lossLimit: 20 });
    await open(s.id, 5, 80);
    prices["BTC/USDT"] = 95; // −25 unrealized
    const r = await monitorSessions(deps());
    expect(r.halted).toEqual([s.id]);
    const after = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(after).toMatchObject({ status: "HALTED", endReason: "LOSS_LIMIT" });
    expect(await prisma.sessionPosition.count({ where: { sessionId: s.id, closedAt: null } })).toBe(0);
  });

  it("asks to extend at the end (Telegram buttons), then ends on timeout with a report", async () => {
    const tg = fakeBot();
    const s = await start();
    await open(s.id, 1, 50);
    const end = s.endsAt.getTime();
    const r1 = await monitorSessions(deps({ now: new Date(end + 1_000), telegram: tg.bot }));
    expect(r1.prompted).toEqual([s.id]);
    expect(tg.sent[0].chatId).toBe("555");
    expect(JSON.stringify(tg.sent[0].keyboard)).toMatch(/Extend 1h.*Extend 2h.*Close all.*Keep with stops/);
    expect(await prisma.telegramAction.count({ where: { sessionId: s.id } })).toBe(4);
    const mid = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(mid).toMatchObject({ status: "AWAITING_EXTENSION", extensionMessageId: 77 });

    await monitorSessions(deps({ now: new Date(end + 3 * 60_000), telegram: tg.bot }));
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("AWAITING_EXTENSION");

    const r3 = await monitorSessions(deps({ now: new Date(end + 7 * 60_000), telegram: tg.bot }));
    expect(r3.ended).toEqual([s.id]);
    expect(tg.edits[0]).toMatch(/no answer in 5 min/);
    const done = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id }, include: { report: true } });
    expect(done).toMatchObject({ status: "ENDED", endReason: "EXTENSION_TIMEOUT" });
    expect(await prisma.sessionPosition.count({ where: { sessionId: s.id, closedAt: null } })).toBe(0);

    await monitorSessions(deps({ now: new Date(end + 8 * 60_000) }));
    const report = await prisma.sessionReport.findUniqueOrThrow({ where: { sessionId: s.id } });
    expect(report.summary).toBe("one losing trade");
    expect(report.metrics).toMatchObject({ trades: 1, capital: 1_000 });
    expect((await listMessages(U, s.id)).some((m) => m.kind === "REPORT")).toBe(true);
  });

  it("keeps enforcing stops after a KEEP_WITH_STOPS end", async () => {
    const s = await start();
    const { positionId } = await open(s.id);
    await endSession(U, s.id, "KEEP_WITH_STOPS", { priceOf, telegram: null });
    await monitorSessions(deps());
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: positionId } })).closedAt).toBeNull();
    prices["BTC/USDT"] = 94;
    await monitorSessions(deps());
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: positionId } })).closeReason).toBe("STOP_LOSS");
    await monitorSessions(deps());
    expect(await prisma.sessionReport.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it("retries a close that had no price", async () => {
    const s = await start();
    await open(s.id);
    prices["BTC/USDT"] = null;
    await endSession(U, s.id, "CLOSE_ALL", { priceOf, telegram: null });
    expect(await prisma.sessionPosition.count({ where: { sessionId: s.id, closedAt: null } })).toBe(1);
    prices["BTC/USDT"] = 101;
    await monitorSessions(deps());
    expect(await prisma.sessionPosition.count({ where: { sessionId: s.id, closedAt: null } })).toBe(0);
  });
});
