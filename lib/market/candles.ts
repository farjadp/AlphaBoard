import YahooFinance from "yahoo-finance2";
import type { Asset } from "@/lib/assetCatalog";
import type { Candle } from "@/lib/candlestickPatterns";
import { marketMemo } from "./cache";
import { fetchJson } from "./http";
import { aggregateCandlesByTime } from "./indicators";
import { TIMEFRAMES, type TimeframeKey } from "./timeframes";

export const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// data-api.binance.vision serves public market data without the geo-blocks that hit api.binance.com
// from US cloud regions; the others are fallbacks.
const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
];

type KlineRow = [number, string, string, string, string, ...unknown[]];

async function fetchBinanceCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  let lastError = "no host tried";
  for (const host of BINANCE_HOSTS) {
    try {
      const rows = await fetchJson<KlineRow[]>(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("empty klines");
      return rows.map((r) => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`binance klines failed: ${lastError}`);
}

type YahooQuote = { date: Date; open?: number | null; high?: number | null; low?: number | null; close?: number | null };

/**
 * Yahoo bars with missing prices (weekend / holiday gaps on FX and metals) come back as nulls, and
 * Number(null) is 0 — a 0 low or close turned a 10-pip EUR/USD hour into a 1.13 true range and
 * poisoned ATR, RSI and EMAs downstream. Keep only bars with four positive, consistent prices.
 */
export function yahooQuotesToCandles(quotes: YahooQuote[]): Candle[] {
  const px = (v: number | null | undefined) => (v == null ? NaN : Number(v));
  return quotes
    .map((q) => ({ time: q.date.getTime(), open: px(q.open), high: px(q.high), low: px(q.low), close: px(q.close) }))
    .filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)
      && c.high >= Math.max(c.open, c.close, c.low) && c.low <= Math.min(c.open, c.close));
}

async function fetchYahooCandles(
  yahooSymbol: string,
  spec: (typeof TIMEFRAMES)[TimeframeKey]["yahoo"],
): Promise<Candle[]> {
  const result = await yf.chart(yahooSymbol, {
    period1: new Date(Date.now() - spec.lookbackDays * 86_400_000),
    interval: spec.interval,
  });
  const candles = yahooQuotesToCandles(result?.quotes ?? []);
  if (candles.length === 0) throw new Error("yahoo returned no candles");
  return spec.bucketMs ? aggregateCandlesByTime(candles, spec.bucketMs) : candles;
}

/** Candles for one asset/timeframe, cached per the timeframe's TTL and shared across users. */
export function getCandles(asset: Asset, key: TimeframeKey): Promise<Candle[]> {
  const spec = TIMEFRAMES[key];
  return marketMemo(`candles:${asset.symbol}:${key}`, spec.cacheTtlMs, async () => {
    const candles = asset.binanceSymbol
      ? await fetchBinanceCandles(asset.binanceSymbol, spec.binance.interval, spec.bars)
      : asset.yahooSymbol
        ? await fetchYahooCandles(asset.yahooSymbol, spec.yahoo)
        : [];
    return candles.slice(-spec.bars);
  });
}
