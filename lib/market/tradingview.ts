import type { Asset } from "@/lib/market/catalog";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/market/timeframes";

/**
 * Catalog symbol → TradingView symbol for the embedded Advanced Real-Time Chart widget.
 * Crypto uses the Binance pair we already stream; everything else maps to a TVC / OANDA feed
 * that the free widget is allowed to show. Null when TradingView has no free feed for it.
 */
const TV_SYMBOLS: Record<string, string> = {
  "FARTCOIN/USD": "BYBIT:FARTCOINUSDT",
  SPX: "TVC:SPX", NDX: "TVC:NDX", DJI: "TVC:DJI", FTSE: "TVC:UKX", DAX: "TVC:DEU40", N225: "TVC:NI225",
  HSI: "TVC:HSI", TSX: "TSX:TSX", SHCOMP: "SSE:000001", ESTX50: "TVC:SX5E", CAC40: "TVC:CAC40",
  BVSP: "BMFBOVESPA:IBOV", ASX200: "ASX:XJO", IPC: "BMV:ME", JSE40: "JSE:J200", KOSPI: "KRX:KOSPI",
  RUT: "TVC:RUT", IBEX: "TVC:IBEX35",
  "XAU/USD": "OANDA:XAUUSD", "XAG/USD": "OANDA:XAGUSD", WTI: "TVC:USOIL", BRENT: "TVC:UKOIL",
  NG: "OANDA:NATGASUSD", COPPER: "OANDA:XCUUSD",
  "EUR/USD": "OANDA:EURUSD", "GBP/USD": "OANDA:GBPUSD", "USD/JPY": "OANDA:USDJPY", "USD/CHF": "OANDA:USDCHF",
  "AUD/USD": "OANDA:AUDUSD", "USD/CAD": "OANDA:USDCAD", "NZD/USD": "OANDA:NZDUSD", "EUR/GBP": "OANDA:EURGBP",
  "EUR/JPY": "OANDA:EURJPY", "USD/TRY": "OANDA:USDTRY",
};

export function tradingViewSymbol(asset: Pick<Asset, "symbol" | "binanceSymbol">): string | null {
  if (asset.binanceSymbol) return `BINANCE:${asset.binanceSymbol}`;
  return TV_SYMBOLS[asset.symbol] ?? null;
}

/** Our timeframe key → the widget's `interval` value. */
export function tradingViewInterval(tf: TimeframeKey): string {
  return { "1M": "M", "1W": "W", "1D": "D", "4H": "240", "1H": "60", "15M": "15", "5M": "5" }[tf];
}

/** Binance kline stream name for a pair and timeframe: "btcusdt@kline_1h". */
export function binanceKlineStream(binanceSymbol: string, tf: TimeframeKey): string {
  return `${binanceSymbol.toLowerCase()}@kline_${TIMEFRAMES[tf].binance.interval}`;
}

export interface LiveBar {
  /** Bar open time, UNIX seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A Binance kline stream message → the bar it carries, or null when the payload is not a kline. */
export function parseKlineMessage(raw: unknown): LiveBar | null {
  const k = (raw as { k?: Record<string, unknown> } | null)?.k;
  if (!k || typeof k.t !== "number") return null;
  const bar = { time: Math.floor(k.t / 1000), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
  return [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) ? bar : null;
}
