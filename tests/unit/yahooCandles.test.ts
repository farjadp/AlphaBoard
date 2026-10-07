import { describe, expect, it } from "vitest";
import { yahooQuotesToCandles } from "@/lib/market/candles";
import { computeAtr } from "@/lib/market/indicators";

const d = (h: number) => new Date(Date.UTC(2026, 9, 6, h));

describe("Yahoo candles", () => {
  it("drops gap bars whose prices are null instead of turning them into zeros", () => {
    const quotes = [
      { date: d(0), open: 1.124, high: 1.125, low: 1.123, close: 1.1245 },
      { date: d(1), open: null, high: null, low: null, close: null },
      { date: d(2), open: 1.1245, high: 1.1255, low: 0, close: 1.125 },
      { date: d(3), open: 1.125, high: 1.126, low: 1.1245, close: 1.1255 },
    ];
    expect(yahooQuotesToCandles(quotes).map((c) => c.time)).toEqual([d(0).getTime(), d(3).getTime()]);
  });

  it("keeps the ATR in pips, not in whole-price jumps", () => {
    const quotes = Array.from({ length: 30 }, (_, i) => (i === 20
      ? { date: d(i), open: null, high: null, low: null, close: null }
      : { date: d(i), open: 1.125, high: 1.1258, low: 1.1242, close: 1.125 }));
    expect(computeAtr(yahooQuotesToCandles(quotes))!).toBeCloseTo(0.0016, 6);
  });
});
