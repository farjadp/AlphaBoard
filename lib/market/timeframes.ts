/**
 * Every timeframe is a distinct candle interval. v1 mixed "lookback" labels (1Y, 3M, 1M)
 * with interval labels and fed near-identical daily data into several of them, which
 * double-counted the same signal in the consensus score.
 */
export const TIMEFRAME_KEYS = ["1M", "1W", "1D", "4H", "1H", "15M", "5M"] as const;
export type TimeframeKey = (typeof TIMEFRAME_KEYS)[number];

export type BinanceInterval = "1M" | "1w" | "1d" | "4h" | "1h" | "15m" | "5m";
export type YahooInterval = "1mo" | "1wk" | "1d" | "60m" | "15m" | "5m";

export interface TimeframeSpec {
  key: TimeframeKey;
  label: string;
  /** Candles kept for indicator computation. */
  bars: number;
  binance: { interval: BinanceInterval };
  /** Yahoo has no native 4h — 60m bars are bucketed into 4h UTC windows. */
  yahoo: { interval: YahooInterval; lookbackDays: number; bucketMs?: number };
  cacheTtlMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const TIMEFRAMES: Record<TimeframeKey, TimeframeSpec> = {
  "1M": { key: "1M", label: "Monthly", bars: 120, binance: { interval: "1M" }, yahoo: { interval: "1mo", lookbackDays: 365 * 15 }, cacheTtlMs: 30 * MIN },
  "1W": { key: "1W", label: "Weekly", bars: 260, binance: { interval: "1w" }, yahoo: { interval: "1wk", lookbackDays: 365 * 6 }, cacheTtlMs: 30 * MIN },
  "1D": { key: "1D", label: "Daily", bars: 300, binance: { interval: "1d" }, yahoo: { interval: "1d", lookbackDays: 500 }, cacheTtlMs: 10 * MIN },
  "4H": { key: "4H", label: "4H", bars: 300, binance: { interval: "4h" }, yahoo: { interval: "60m", lookbackDays: 400, bucketMs: 4 * HOUR }, cacheTtlMs: 5 * MIN },
  "1H": { key: "1H", label: "1H", bars: 300, binance: { interval: "1h" }, yahoo: { interval: "60m", lookbackDays: 90 }, cacheTtlMs: 2 * MIN },
  "15M": { key: "15M", label: "15M", bars: 300, binance: { interval: "15m" }, yahoo: { interval: "15m", lookbackDays: 30 }, cacheTtlMs: 1 * MIN },
  "5M": { key: "5M", label: "5M", bars: 300, binance: { interval: "5m" }, yahoo: { interval: "5m", lookbackDays: 10 }, cacheTtlMs: 30_000 },
};

/** Timeframes the user can pick as the primary report. */
export const REPORT_TIMEFRAMES: TimeframeKey[] = ["1M", "1W", "1D", "4H", "1H", "15M"];

/** Timeframes scored in the multi-timeframe consensus, highest first. */
export const CONSENSUS_TIMEFRAMES: TimeframeKey[] = ["1W", "1D", "4H", "1H", "15M", "5M"];

export const CONSENSUS_WEIGHTS: Record<string, number> = {
  "1W": 1.8, "1D": 1.5, "4H": 1.2, "1H": 1.0, "15M": 0.7, "5M": 0.5,
};

/** Higher-timeframe "structure" vs lower-timeframe "execution" groups for the confluence check. */
export const HTF_KEYS = new Set<string>(["1W", "1D"]);
export const LTF_KEYS = new Set<string>(["4H", "1H"]);

export function isTimeframeKey(value: unknown): value is TimeframeKey {
  return typeof value === "string" && (TIMEFRAME_KEYS as readonly string[]).includes(value);
}
