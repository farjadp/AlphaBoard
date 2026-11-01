import { describe, it, expect } from "vitest";
import { tradingViewSymbol, tradingViewInterval, binanceKlineStream, parseKlineMessage } from "@/lib/market/tradingview";
import { ema } from "@/lib/market/chartStudies";
import { ASSET_CATALOG } from "@/lib/market/catalog";

describe("tradingViewSymbol", () => {
  it("maps crypto to the Binance pair and tradfi to a free feed", () => {
    expect(tradingViewSymbol({ symbol: "BTC/USDT", binanceSymbol: "BTCUSDT" })).toBe("BINANCE:BTCUSDT");
    expect(tradingViewSymbol({ symbol: "XAU/USD" })).toBe("OANDA:XAUUSD");
    expect(tradingViewSymbol({ symbol: "NOPE" })).toBeNull();
  });
  it("covers every catalog asset except the ones TradingView has no free feed for", () => {
    const missing = ASSET_CATALOG.filter((a) => !tradingViewSymbol(a)).map((a) => a.symbol);
    expect(missing).toEqual(["BVLPG"]);
  });
});

describe("intervals and streams", () => {
  it("maps timeframes", () => {
    expect(tradingViewInterval("1H")).toBe("60");
    expect(tradingViewInterval("1D")).toBe("D");
    expect(binanceKlineStream("BTCUSDT", "4H")).toBe("btcusdt@kline_4h");
  });
});

describe("parseKlineMessage", () => {
  it("reads a kline payload", () => {
    const msg = { e: "kline", k: { t: 1_700_000_000_000, o: "1", h: "3", l: "0.5", c: "2", v: "10", x: false } };
    expect(parseKlineMessage(msg)).toEqual({ time: 1_700_000_000, open: 1, high: 3, low: 0.5, close: 2, volume: 10 });
  });
  it("rejects anything else", () => {
    expect(parseKlineMessage({ result: null, id: 1 })).toBeNull();
    expect(parseKlineMessage({ k: { t: 1, o: "x", h: "1", l: "1", c: "1", v: "1" } })).toBeNull();
    expect(parseKlineMessage(null)).toBeNull();
  });
});

describe("ema", () => {
  it("seeds with the simple average then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3);
    expect(out[4]).toBe(4);
  });
  it("returns all nulls when there are too few values", () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });
});

import { validUntil } from "@/lib/eval/evaluator";
describe("validUntil", () => {
  it("adds the timeframe's horizon to the issue time", () => {
    const t0 = new Date("2026-11-01T12:00:00Z");
    expect(validUntil(t0, "1H")?.toISOString()).toBe("2026-11-04T12:00:00.000Z"); // 72 bars
    expect(validUntil(t0, "15m")?.toISOString()).toBe("2026-11-02T12:00:00.000Z"); // 96 bars
    expect(validUntil(t0, "2H")).toBeNull();
  });
});
