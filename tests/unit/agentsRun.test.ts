import { describe, it, expect } from "vitest";
import type { AiRequest } from "@/lib/ai";
import { formatContext, type ContextData } from "@/lib/agents/context";
import { runAnalysts, runStrategist, type AiFn } from "@/lib/agents/run";
import { parseMandate } from "@/lib/sessions/mandate";

const mandate = parseMandate({ symbols: ["BTC/USDT", "ETH/USDT"], capital: 500, models: { analyst: { provider: "deepseek", model: "deepseek-flash" } } });

const ctx: ContextData = {
  now: "2026-09-28T12:00:00Z",
  mandate,
  usage: { equity: 500, freeCapital: 500, lossUsed: 0, lossLimit: 50, tradesUsed: 0, maxTrades: 6, openPositions: 1, maxOpenPositions: 2, timeLeftMin: 400, llmCostUsd: 0.01, maxLlmCostUsd: 1 },
  symbols: [
    { symbol: "BTC/USDT", price: 100_000, changePct24h: 1.2, timeframes: [{ timeframe: "4H", available: true, trend: "Bullish", stretch: "Neutral", rsi: 58.2, atr: 900, macd: "Bullish", ema: "Above EMA20" }, { timeframe: "1D", available: false, trend: "Neutral", stretch: "Neutral", rsi: null, atr: null, macd: "", ema: "" }],
      consensus: { netScore: 40, dominantBias: "Bullish", confluenceStrength: "Moderate" }, funding: null, news: [{ headline: "ETF inflows rise", sentiment: "bullish", publishedAt: "2026-09-28T10:00:00Z" }] },
    { symbol: "ETH/USDT", price: null, changePct24h: null, timeframes: [], consensus: null, funding: null, news: [] },
  ],
  positions: [{ id: "pos1", symbol: "BTC/USDT", side: "LONG", qty: 0.001, entryPrice: 99_000, mark: 100_000, unrealizedPnl: 1, stopLoss: 97_000, takeProfit: 104_000, thesis: "breakout", invalidation: "4H close below 98k", horizonMin: 240, ageMin: 30 }],
  lessons: ["Do not chase after a 3% candle"],
};

function stubAi(answers: Record<string, unknown>, seen: AiRequest<never>[] = []): AiFn {
  return (async (req: AiRequest<never>) => {
    seen.push(req);
    const data = (req.schema as unknown as { parse(v: unknown): unknown }).parse(answers[req.feature]);
    return { data, meta: { provider: "openai", model: "m", inputTokens: 10, outputTokens: 10, costUsd: 0.002, visionFallback: false } };
  }) as unknown as AiFn;
}

describe("context block", () => {
  it("states missing data as unavailable and includes positions, limits and lessons", () => {
    const text = formatContext(ctx);
    expect(text).toContain("ETH/USDT");
    expect(text).toMatch(/Price: unavailable/);
    expect(text).toMatch(/1D: unavailable/);
    expect(text).toContain("id pos1");
    expect(text).toContain("invalidation: 4H close below 98k");
    expect(text).toMatch(/trades 0\/6/);
    expect(text).toContain("Do not chase");
  });
  it("gives analysts only their slice", () => {
    expect(formatContext(ctx, "technical")).not.toContain("Headlines");
    expect(formatContext(ctx, "news")).not.toContain("RSI");
    expect(formatContext(ctx, "news")).not.toContain("OPEN POSITIONS");
  });
});

describe("agent runners", () => {
  const note = { notes: [{ symbol: "BTC/USDT", stance: "bullish", confidence: 0.6, summary: "up", keyPoints: [] }] };

  it("analysts run in parallel on the analyst model and add up cost", async () => {
    const seen: AiRequest<never>[] = [];
    const r = await runAnalysts({ ai: stubAi({ "session.market": note, "session.news": note }, seen), userId: "u", mandate }, ctx);
    expect(seen.map((s) => s.feature).sort()).toEqual(["session.market", "session.news"]);
    expect(seen.every((s) => s.model?.model === "deepseek-flash")).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.004, 10);
  });

  it("strategist decisions become proposals; foreign symbols and unknown position ids are handled", async () => {
    const plan = {
      commentary: "trend intact",
      decisions: [
        { action: "TIGHTEN_STOP", symbol: "BTC/USDT", positionId: "pos1", conviction: 0.6, thesis: "protect", stopLoss: 98_500, takeProfit: null, invalidation: "", horizonMin: 120 },
        { action: "OPEN_LONG", symbol: "ETH/USDT", positionId: "ghost", conviction: 0.5, thesis: "t", stopLoss: 1, takeProfit: 3, invalidation: "i", horizonMin: 60 },
        { action: "OPEN_LONG", symbol: "DOGE/USDT", positionId: null, conviction: 0.9, thesis: "moon", stopLoss: 0.1, takeProfit: 1, invalidation: "i", horizonMin: 60 },
      ],
    };
    const seen: AiRequest<never>[] = [];
    const r = await runStrategist({ ai: stubAi({ "session.strategist": plan }, seen), userId: "u", mandate }, ctx, note as never, note as never, null);
    expect(seen[0].model).toBeNull();
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals[0]).toMatchObject({ action: "TIGHTEN_STOP", positionId: "pos1", exitPlan: { stopLoss: 98_500 } });
    expect(r.proposals[1].positionId).toBeNull();
    expect(r.dropped[0]).toMatch(/DOGE/);
    expect(r.commentary).toBe("trend intact");
  });
});
