import type { Asset } from "@/lib/assetCatalog";
import { logger } from "@/lib/http/logger";
import { marketMemo } from "./cache";
import { yf } from "./candles";
import { binanceJson } from "./http";

export interface Quote {
  price: number;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volume: number | null; // quote-currency volume where the provider reports it
  source: "binance" | "yahoo";
  asOf: string;
}

const fin = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function binanceQuote(symbol: string): Promise<Quote> {
  type T = { lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string; closeTime: number };
  const t = await binanceJson<T>(`/api/v3/ticker/24hr?symbol=${symbol}`, (b) => (fin(b.lastPrice) ? null : "no price"));
  return { price: fin(t.lastPrice)!, changePct: fin(t.priceChangePercent), high: fin(t.highPrice), low: fin(t.lowPrice), volume: fin(t.quoteVolume), source: "binance", asOf: new Date(t.closeTime).toISOString() };
}

async function yahooQuote(symbol: string): Promise<Quote> {
  const q = await yf.quote(symbol);
  const price = fin(q?.regularMarketPrice);
  if (!price) throw new Error(`yahoo: no price for ${symbol}`);
  return {
    price,
    changePct: fin(q.regularMarketChangePercent),
    high: fin(q.regularMarketDayHigh),
    low: fin(q.regularMarketDayLow),
    volume: fin(q.regularMarketVolume),
    source: "yahoo",
    asOf: (q.regularMarketTime instanceof Date ? q.regularMarketTime : new Date()).toISOString(),
  };
}

/** Live quote, cached 15s. Returns null when every provider fails — never a placeholder price. */
export async function getQuote(asset: Asset): Promise<Quote | null> {
  try {
    return await marketMemo(`quote:${asset.symbol}`, 15_000, () =>
      asset.binanceSymbol ? binanceQuote(asset.binanceSymbol) : yahooQuote(asset.yahooSymbol!),
    );
  } catch (e) {
    logger.warn({ symbol: asset.symbol, err: e instanceof Error ? e.message : String(e) }, "quote unavailable");
    return null;
  }
}
