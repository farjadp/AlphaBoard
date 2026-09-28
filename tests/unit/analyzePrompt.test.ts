import { describe, it, expect } from "vitest";
import { buildAnalyzePrompt, sanitizeLessons } from "@/lib/ai/prompts/analyze";

const ctx = {
  symbol: "BTC/USDT",
  assetName: "Bitcoin",
  timeframe: "4H",
  quote: { price: 83000, changePct: 1.2, source: "binance", asOf: "2026-09-28T00:00:00Z" },
  headlines: ["ETF inflows rise", "Miners sell"],
  report: {
    rsi: 61.2, rsiSignal: "Neutral", macd: { MACD: 120, signal: 100 }, macdSignal: "Bullish",
    sma50: 80000, sma100: 78000, sma200: 70000, sma250: 69000, ema5: 82900, ema10: 82500, ema20: 82000,
    bollingerBands: { lower: 79000, middle: 81000, upper: 84000 }, bbSignal: "Neutral", atr: 900,
    trendSignal: "Bullish", stretchSignal: "Neutral",
    candlestickPattern: { name: "Hammer", bias: "Bullish", description: "d" },
    chartPatternMatches: [{ name: "Bullish Order Block", bias: "Bullish", confidence: 80, description: "ob" }],
    multiTimeframes: [{ timeframe: "1D", available: true, trendSignal: "Bullish", stretchSignal: "Neutral", rsiSignal: "Neutral", macdSignal: "Bullish", emaSignal: "Above 20 EMA", atr: 2000 }],
    consensusScore: { netScore: 70, dominantBias: "Bullish", bullishPressure: 75, bearishPressure: 25, coverage: 100, confluenceStrength: "Strong" },
  },
  futures: { fundingRatePct: 0.0064, openInterestUsd: 7.9e9, longPct: 57.4, shortPct: 42.6, source: "binance" },
  balanceSheet: { marketCap: 1.6e12, fdv: 1.7e12 },
  cashflow: null,
  pastLessons: [],
  chartLessons: [],
} as const;

describe("buildAnalyzePrompt", () => {
  const prompt = buildAnalyzePrompt(ctx as never);

  it("uses real newlines, never literal backslash-n", () => {
    expect(prompt).not.toContain("\\n");
    expect(prompt).toContain("- ETF inflows rise\n- Miners sell");
  });
  it("contains exactly one data block and no leftover placeholder text", () => {
    expect(prompt.match(/^## DATA/gm)).toHaveLength(1);
    expect(prompt).not.toMatch(/remains the same/i);
  });
  it("includes the server-side price, ATR stop buffer, futures and consensus", () => {
    expect(prompt).toContain("Current price: 83000");
    expect(prompt).toContain("ATR (14): 900 | ATR x1.5 stop buffer: 1350");
    expect(prompt).toContain("Funding rate: 0.0064%");
    expect(prompt).toContain("Long/short accounts: 57.4% / 42.6%");
    expect(prompt).toContain("Confluence: Strong");
  });
  it("says explicitly when data is unavailable instead of inventing it", () => {
    expect(prompt).toContain("Cashflow: unavailable");
  });
});

describe("sanitizeLessons", () => {
  it("caps count and field length so lesson text cannot blow up the prompt", () => {
    const long = "x".repeat(5000);
    const out = sanitizeLessons({
      pastLessons: Array.from({ length: 20 }, () => ({ symbol: "BTC/USDT", lesson: long, rootCause: long, tags: ["a"] })),
      chartLessons: Array.from({ length: 20 }, () => ({ signal: "BUY", lesson: long, patterns: ["OB"] })),
    });
    expect(out.pastLessons).toHaveLength(6);
    expect(out.chartLessons).toHaveLength(5);
    expect(out.pastLessons[0].lesson!.length).toBeLessThanOrEqual(400);
  });
});
