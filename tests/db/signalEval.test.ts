/** Signal evaluation against Postgres with injected candles: job idempotency, ownership, filters. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { evaluatePendingSignals } from "@/lib/eval/job";
import { userPerformance } from "@/lib/eval/performance";
import { listSignals } from "@/lib/db/signals";

const run = !!process.env.TEST_DATABASE_URL;
const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1, 10, 30);
const bars = (highs: number[], lows: number[]) => [
  { time: Date.UTC(2026, 8, 1, 10), open: 100, high: 100, low: 100, close: 100 },
  ...highs.map((h, i) => ({ time: Date.UTC(2026, 8, 1, 11) + i * H, open: 100, high: h, low: lows[i], close: 100 })),
];

describe.skipIf(!run)("signal evaluation (Postgres)", () => {
  let A: string, B: string;
  const sig = (userId: string, extra: Record<string, unknown> = {}) => prisma.signal.create({
    data: {
      userId, symbol: "BTC/USDT", timeframe: "1H", signal: "BUY", confidence: 70, priceAtSignal: 100, entry: 100,
      stopLoss: 95, takeProfit: 110, reasoning: "r", provider: "openai", model: "gpt-5.4-mini", createdAt: new Date(T0), ...extra,
    },
  });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "ea@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "eb@test.local", passwordHash: "x" } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("evaluates pending signals once per (symbol, timeframe), keeps OPEN ones, and never re-opens resolved ones", async () => {
    const win = await sig(A);
    const eth = await sig(A, { symbol: "ETH/USDT", model: "gpt-4o-2024-08-06", confidence: 85 });
    const hold = await sig(A, { signal: "HOLD" });
    await sig(B);
    const calls: string[] = [];
    const now = new Date(T0 + 10 * H);
    const r1 = await evaluatePendingSignals({
      now,
      barsOf: async (symbol, tf) => { calls.push(`${symbol}:${tf}`); return symbol === "BTC/USDT" ? bars([104, 111], [99, 101]) : bars([103], [96]); },
    });
    expect(calls.sort()).toEqual(["BTC/USDT:1H", "ETH/USDT:1H"]);
    expect(r1).toMatchObject({ checked: 3, resolved: 2 }); // two BTC (A and B) hit TP; ETH still open
    expect(await prisma.signalEvaluation.findUnique({ where: { signalId: win.id } })).toMatchObject({ status: "TP_HIT", rMultiple: 2 });
    expect(await prisma.signalEvaluation.findUnique({ where: { signalId: eth.id } })).toMatchObject({ status: "OPEN" });
    expect(await prisma.signalEvaluation.findUnique({ where: { signalId: hold.id } })).toBeNull();

    // Later candles would say "stop" — a resolved outcome is final; only the ETH one is re-checked.
    const r2 = await evaluatePendingSignals({ now, barsOf: async () => bars([101, 101], [90, 90]) });
    expect(r2.checked).toBe(1);
    expect(await prisma.signalEvaluation.findUnique({ where: { signalId: win.id } })).toMatchObject({ status: "TP_HIT" });
    expect(await prisma.signalEvaluation.findUnique({ where: { signalId: eth.id } })).toMatchObject({ status: "SL_HIT", rMultiple: -1 });
  });

  it("leaves signals pending (not failed) when market data is unavailable", async () => {
    const s = await sig(A, { symbol: "SOL/USDT" });
    const r = await evaluatePendingSignals({ now: new Date(T0 + 5 * H), barsOf: async () => { throw new Error("binance down"); } });
    expect(r.errors[0]).toMatch(/binance down/);
    expect(await prisma.signalEvaluation.findUnique({ where: { signalId: s.id } })).toBeNull();
  });

  it("marks unsupported symbols invalid instead of retrying forever", async () => {
    const s = await sig(A, { symbol: "DOGE/XYZ" });
    await evaluatePendingSignals({ now: new Date(T0 + 5 * H), barsOf: async () => null });
    expect(await prisma.signalEvaluation.findUnique({ where: { signalId: s.id } })).toMatchObject({ status: "INVALID" });
  });

  it("performance is per user and honours filters; the archive carries each outcome", async () => {
    const all = await userPerformance(A, {}, new Date(T0 + 10 * H));
    expect(all.summary).toMatchObject({ trades: 2, wins: 1, invalid: 1, open: 1 }); // BTC TP, ETH SL, DOGE invalid, SOL pending
    expect(all.summary.expectancyR).toBeCloseTo(0.5, 10);
    expect(all.holds).toBe(1);
    expect(all.options.models).toEqual(["gpt-4o", "gpt-5.4-mini"]);

    const byModel = await userPerformance(A, { model: "gpt-4o" }, new Date(T0 + 10 * H));
    expect(byModel.summary).toMatchObject({ trades: 1, wins: 0 });
    expect((await userPerformance(A, { days: 1 }, new Date(T0 + 30 * 86_400_000))).summary.trades).toBe(0);

    const other = await userPerformance(B, {}, new Date(T0 + 10 * H));
    expect(other.summary).toMatchObject({ trades: 1, wins: 1 });
    expect(other.options.symbols).toEqual(["BTC/USDT"]);

    const archived = await listSignals(A);
    expect(archived.find((s) => s.symbol === "BTC/USDT" && s.signal === "BUY")?.evaluation).toMatchObject({ status: "TP_HIT", rMultiple: 2 });
  });
});
