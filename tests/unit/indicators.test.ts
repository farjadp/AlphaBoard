import { describe, it, expect } from "vitest";
import {
  aggregateCandlesByTime,
  calculateConsensusScore,
  calculateIndicatorSnapshot,
  calculateStretchSignal,
  calculateTrendSignal,
  computeAtr,
  MIN_BARS,
  unavailableSnapshot,
} from "@/lib/market/indicators";
import type { Candle } from "@/lib/candlestickPatterns";

const H = 3_600_000;

function trendingCandles(n: number, start: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const open = start + i * step;
    const close = open + step * 0.8;
    return { time: i * H, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1 };
  });
}

describe("calculateTrendSignal", () => {
  it("is bullish when MACD, SMA and EMA all agree up", () => {
    expect(calculateTrendSignal({ macd: "Bullish", sma: "Above 50 SMA", ema: "Above 20 EMA", candlestick: "Neutral", chartPattern: "Neutral" })).toBe("Bullish");
  });
  it("is bearish when trend components agree down", () => {
    expect(calculateTrendSignal({ macd: "Bearish", sma: "Below 50 SMA", ema: "Below 20 EMA", candlestick: "Neutral", chartPattern: "Bearish" })).toBe("Bearish");
  });
  it("is neutral when components are mixed", () => {
    expect(calculateTrendSignal({ macd: "Bullish", sma: "Below 50 SMA", ema: "Above 20 EMA", candlestick: "Bearish", chartPattern: "Neutral" })).toBe("Neutral");
  });
  it("does not accept RSI/Bollinger inputs — mean reversion is scored separately", () => {
    // Regression for the v1 bug where an overbought RSI pulled a strong uptrend toward Neutral.
    const parts = { macd: "Bullish", sma: "Above 50 SMA", ema: "Above 20 EMA", candlestick: "Neutral", chartPattern: "Neutral" } as const;
    expect(calculateTrendSignal(parts)).toBe("Bullish");
  });
});

describe("calculateStretchSignal", () => {
  it("reports Overbought when RSI or BB is overbought and neither is oversold", () => {
    expect(calculateStretchSignal("Overbought", "Neutral")).toBe("Overbought");
    expect(calculateStretchSignal("Neutral", "Overbought")).toBe("Overbought");
  });
  it("reports Oversold symmetrically", () => {
    expect(calculateStretchSignal("Oversold", "Oversold")).toBe("Oversold");
  });
  it("is Neutral on conflict or missing data", () => {
    expect(calculateStretchSignal("Overbought", "Oversold")).toBe("Neutral");
    expect(calculateStretchSignal("Insufficient Data", "Neutral")).toBe("Neutral");
  });
});

describe("computeAtr (Wilder, 14)", () => {
  it("equals the constant true range for gapless candles", () => {
    const candles: Candle[] = Array.from({ length: 30 }, () => ({ open: 100, close: 100, high: 101, low: 99 }));
    expect(computeAtr(candles)).toBeCloseTo(2, 10);
  });
  it("accounts for gaps via previous close", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({ open: 100 + i * 10, close: 100 + i * 10, high: 100 + i * 10, low: 100 + i * 10 }));
    expect(computeAtr(candles)).toBeCloseTo(10, 10);
  });
  it("returns null with fewer than period+1 candles", () => {
    expect(computeAtr(trendingCandles(10, 100, 1))).toBeNull();
  });
});

describe("aggregateCandlesByTime", () => {
  it("groups hourly candles into 4h UTC buckets with correct OHLC", () => {
    const hourly: Candle[] = [
      { time: 0 * H, open: 10, high: 12, low: 9, close: 11 },
      { time: 1 * H, open: 11, high: 15, low: 10, close: 14 },
      { time: 2 * H, open: 14, high: 14, low: 8, close: 9 },
      { time: 3 * H, open: 9, high: 10, low: 7, close: 8 },
      { time: 4 * H, open: 8, high: 9, low: 6, close: 7 },
    ];
    const out = aggregateCandlesByTime(hourly, 4 * H);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ time: 0, open: 10, high: 15, low: 7, close: 8 });
    expect(out[1]).toEqual({ time: 4 * H, open: 8, high: 9, low: 6, close: 7 });
  });
  it("handles session gaps (bars missing inside a bucket) without shifting later buckets", () => {
    const bars: Candle[] = [
      { time: 13 * H, open: 1, high: 2, low: 1, close: 2 },
      { time: 17 * H, open: 2, high: 3, low: 2, close: 3 },
    ];
    const out = aggregateCandlesByTime(bars, 4 * H);
    expect(out.map((c) => c.time)).toEqual([12 * H, 16 * H]);
  });
});

describe("calculateIndicatorSnapshot", () => {
  it("marks the snapshot unavailable below MIN_BARS", () => {
    const snap = calculateIndicatorSnapshot("1H", trendingCandles(MIN_BARS - 1, 100, 1));
    expect(snap.available).toBe(false);
    expect(snap.unavailableReason).toMatch(/candles/i);
  });
  it("computes a bullish trend on a clean uptrend and exposes stretch separately", () => {
    const snap = calculateIndicatorSnapshot("1H", trendingCandles(260, 100, 2));
    expect(snap.available).toBe(true);
    expect(snap.trendSignal).toBe("Bullish");
    expect(snap.macdSignal).toBeDefined();
    expect(["Overbought", "Oversold", "Neutral"]).toContain(snap.stretchSignal);
    expect(snap.sma200).not.toBeNull();
    expect(snap.atr).not.toBeNull();
    expect(snap.candleCount).toBe(260);
  });
});

describe("calculateConsensusScore", () => {
  const snap = (timeframe: string, trend: "Bullish" | "Bearish" | "Neutral", available = true) => ({
    ...unavailableSnapshot(timeframe, "test"),
    available,
    trendSignal: trend,
  });

  it("ignores unavailable timeframes in weights and reports real coverage", () => {
    const score = calculateConsensusScore([
      snap("1W", "Bullish"), snap("1D", "Bullish"), snap("4H", "Bullish"), snap("1H", "Bullish"),
      snap("15M", "Bearish", false), snap("5M", "Bearish", false),
    ]);
    expect(score.coverage).toBe(67);
    expect(score.dominantBias).toBe("Bullish");
    expect(score.netScore).toBeGreaterThan(90);
    expect(score.confluenceStrength).toBe("Strong");
  });

  it("flags HTF vs LTF conflict and pulls the score toward neutral", () => {
    const score = calculateConsensusScore([
      snap("1W", "Bearish"), snap("1D", "Bearish"), snap("4H", "Bullish"), snap("1H", "Bullish"),
      snap("15M", "Bullish"), snap("5M", "Bullish"),
    ]);
    expect(score.confluenceStrength).toBe("Conflicting");
  });

  it("returns a neutral, zero-coverage score when nothing is available", () => {
    const score = calculateConsensusScore([snap("1W", "Bullish", false)]);
    expect(score).toMatchObject({ netScore: 50, dominantBias: "Neutral", coverage: 0, confluenceStrength: "Weak" });
  });
});
