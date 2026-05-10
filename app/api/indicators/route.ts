import { NextResponse } from "next/server";
import { RSI, MACD, SMA, EMA, BollingerBands } from "technicalindicators";
import YahooFinance from "yahoo-finance2";
import { ASSET_CATALOG } from "@/lib/assetCatalog";
import { detectCandlestickPatterns, type Candle } from "@/lib/candlestickPatterns";
import { detectChartPatterns } from "@/lib/chartPatterns";

const yf = new YahooFinance();
type PairDef = (typeof ASSET_CATALOG)[number];
type BinanceKlineRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];
type YahooHistoricalRow = {
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
};
type BinanceInterval = "5m" | "15m" | "1h" | "4h" | "1d";
type YahooInterval = "1d";
type TrendSignal = "Bullish" | "Bearish" | "Neutral";
type ConsensusScore = {
  bullishPressure: number;
  bearishPressure: number;
  netScore: number;
  dominantBias: TrendSignal;
  coverage: number;
};

interface TimeframeSpec {
  key: string;
  binanceInterval: BinanceInterval;
  yahooInterval: YahooInterval;
  limit: number;
  periodDays: number;
  aggregateSize?: number;
}

interface IndicatorSnapshot {
  timeframe: string;
  currentPrice: number | null;
  rsi: number | null;
  rsiSignal: string;
  macd: { MACD?: number; signal?: number; histogram?: number } | null;
  macdSignal: string;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  sma250: number | null;
  smaSignal: string;
  ema5: number | null;
  ema10: number | null;
  ema20: number | null;
  emaSignal: string;
  bollingerBands: { lower: number; middle: number; upper: number; pb?: number } | null;
  bbSignal: string;
  candlestickPattern: ReturnType<typeof detectCandlestickPatterns>["primary"];
  candlestickMatches: ReturnType<typeof detectCandlestickPatterns>["matches"];
  chartPattern: ReturnType<typeof detectChartPatterns>["primary"];
  chartPatternMatches: ReturnType<typeof detectChartPatterns>["matches"];
  trendSignal: TrendSignal;
  available: boolean;
}

const BASE_TIMEFRAME: TimeframeSpec = {
  key: "1H",
  binanceInterval: "1h",
  yahooInterval: "1d",
  limit: 300,
  periodDays: 30,
};

const DAILY_TIMEFRAME: TimeframeSpec = {
  key: "1D",
  binanceInterval: "1d",
  yahooInterval: "1d",
  limit: 300,
  periodDays: 400,
};

const MULTI_TIMEFRAMES: TimeframeSpec[] = [
  { key: "1Y", binanceInterval: "1d", yahooInterval: "1d", limit: 365, periodDays: 400 },
  { key: "3M", binanceInterval: "1d", yahooInterval: "1d", limit: 90,  periodDays: 120 },
  // For Yahoo Finance, periodDays must always be >= 60 so pattern detectors get enough candles.
  // limit is applied AFTER fetching, so the slice will trim to the right number.
  { key: "1M", binanceInterval: "1h",  yahooInterval: "1d", limit: 30,  periodDays: 60 },
  { key: "1W", binanceInterval: "15m", yahooInterval: "1d", limit: 30,  periodDays: 60 },
  { key: "4H", binanceInterval: "4h",  yahooInterval: "1d", limit: 300, periodDays: 70, aggregateSize: 4 },
  { key: "45M", binanceInterval: "15m", yahooInterval: "1d", limit: 300, periodDays: 14, aggregateSize: 3 },
  { key: "15M", binanceInterval: "15m", yahooInterval: "1d", limit: 300, periodDays: 14 },
  { key: "5M",  binanceInterval: "5m",  yahooInterval: "1d", limit: 300, periodDays: 7 },
];
const TIMEFRAME_WEIGHTS: Record<string, number> = {
  "1Y": 1.8,
  "3M": 1.6,
  "1M": 1.4,
  "1W": 1.2,
  "4H": 1,
  "45M": 0.85,
  "15M": 0.7,
  "5M": 0.55,
};

export const revalidate = 300; // Cache for 5 minutes

function buildPeriodStart(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

function aggregateCandles(candles: Candle[], groupSize: number) {
  if (groupSize <= 1) return candles;

  const remainder = candles.length % groupSize;
  const normalized = remainder === 0 ? candles : candles.slice(remainder);
  const aggregated: Candle[] = [];

  for (let index = 0; index < normalized.length; index += groupSize) {
    const slice = normalized.slice(index, index + groupSize);
    if (slice.length < groupSize) continue;

    aggregated.push({
      open: slice[0].open,
      high: Math.max(...slice.map((candle) => candle.high)),
      low: Math.min(...slice.map((candle) => candle.low)),
      close: slice[slice.length - 1].close,
    });
  }

  return aggregated;
}

const BINANCE_BASE_URLS = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://data-api.binance.vision"
];

async function fetchBinanceCandles(symbol: string, interval: BinanceInterval, limit: number) {
  const binanceSymbol = symbol.replace("/", "").toUpperCase();
  let lastError: Error | null = null;

  for (const baseUrl of BINANCE_BASE_URLS) {
    try {
      const url = `${baseUrl}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
      const response = await fetch(url, { next: { revalidate: 300 } });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Invalid kline data");
      }

      return (data as BinanceKlineRow[]).map((row) => ({
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
      }));
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // Continue to next URL
    }
  }

  throw new Error(`Failed to fetch klines from Binance after trying multiple endpoints. Last error: ${lastError?.message}`);
}

async function fetchYahooCandles(symbol: string, interval: YahooInterval, periodDays: number) {
  const result = await yf.chart(symbol, {
    period1: buildPeriodStart(periodDays),
    interval,
  });

  if (!result || !result.quotes || result.quotes.length === 0) {
    throw new Error("Invalid Yahoo Finance data");
  }

  return result.quotes
    .map((row) => ({
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }))
    .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value)));
}

async function fetchCandlesForTimeframe(pairDef: PairDef, symbol: string, spec: TimeframeSpec) {
  if (pairDef.category !== "crypto" && ["4H", "45M", "15M", "5M"].includes(spec.key)) {
    throw new Error("Intraday timeframe unavailable for this asset");
  }

  const rawCandles = pairDef.category === "crypto"
    ? await fetchBinanceCandles(symbol, spec.binanceInterval, spec.limit * (spec.aggregateSize ?? 1))
    : await fetchYahooCandles(pairDef.yahooSymbol!, spec.yahooInterval, spec.periodDays);

  const candles = spec.aggregateSize ? aggregateCandles(rawCandles, spec.aggregateSize) : rawCandles;
  return candles.slice(-spec.limit);
}

function calculateTrendSignal(parts: Array<TrendSignal | string>) {
  let score = 0;

  for (const part of parts) {
    if (part === "Bullish" || part.startsWith("Above") || part === "Oversold") score += 1;
    if (part === "Bearish" || part.startsWith("Below") || part === "Overbought") score -= 1;
  }

  if (score >= 2) return "Bullish" as const;
  if (score <= -2) return "Bearish" as const;
  return "Neutral" as const;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function calculateConsensusScore(timeframes: IndicatorSnapshot[]): ConsensusScore {
  const available = timeframes.filter((item) => item.available);
  const totalWeight = available.reduce((sum, item) => sum + (TIMEFRAME_WEIGHTS[item.timeframe] ?? 1), 0);

  if (available.length === 0 || totalWeight === 0) {
    return {
      bullishPressure: 50,
      bearishPressure: 50,
      netScore: 50,
      dominantBias: "Neutral",
      coverage: 0,
    };
  }

  const bullishWeight = available
    .filter((item) => item.trendSignal === "Bullish")
    .reduce((sum, item) => sum + (TIMEFRAME_WEIGHTS[item.timeframe] ?? 1), 0);
  const bearishWeight = available
    .filter((item) => item.trendSignal === "Bearish")
    .reduce((sum, item) => sum + (TIMEFRAME_WEIGHTS[item.timeframe] ?? 1), 0);
  const neutralWeight = available
    .filter((item) => item.trendSignal === "Neutral")
    .reduce((sum, item) => sum + (TIMEFRAME_WEIGHTS[item.timeframe] ?? 1), 0);

  const bullishPressure = clamp(Number((((bullishWeight + neutralWeight * 0.5) / totalWeight) * 100).toFixed(1)), 0, 100);
  const bearishPressure = clamp(Number((((bearishWeight + neutralWeight * 0.5) / totalWeight) * 100).toFixed(1)), 0, 100);
  const netScore = clamp(Number((50 + ((bullishWeight - bearishWeight) / totalWeight) * 50).toFixed(1)), 0, 100);
  const dominantBias = netScore >= 57 ? "Bullish" : netScore <= 43 ? "Bearish" : "Neutral";
  const coverage = clamp(Number(((available.length / MULTI_TIMEFRAMES.length) * 100).toFixed(0)), 0, 100);

  return {
    bullishPressure,
    bearishPressure,
    netScore,
    dominantBias,
    coverage,
  };
}

function calculateIndicatorSnapshot(timeframe: string, candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((candle) => candle.close);
  const currentPrice = closes.at(-1) ?? null;

  const rsiValues = closes.length >= 14 ? RSI.calculate({ values: closes, period: 14 }) : [];
  const latestRsi = rsiValues.at(-1) ?? null;

  const macdValues = closes.length >= 35
    ? MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      })
    : [];
  const latestMacd = macdValues.at(-1) ?? null;

  const sma50 = closes.length >= 50 ? (SMA.calculate({ values: closes, period: 50 }).at(-1) ?? null) : null;
  const sma100 = closes.length >= 100 ? (SMA.calculate({ values: closes, period: 100 }).at(-1) ?? null) : null;
  const sma200 = closes.length >= 200 ? (SMA.calculate({ values: closes, period: 200 }).at(-1) ?? null) : null;
  const sma250 = closes.length >= 250 ? (SMA.calculate({ values: closes, period: 250 }).at(-1) ?? null) : null;

  const ema5 = closes.length >= 5 ? (EMA.calculate({ values: closes, period: 5 }).at(-1) ?? null) : null;
  const ema10 = closes.length >= 10 ? (EMA.calculate({ values: closes, period: 10 }).at(-1) ?? null) : null;
  const ema20 = closes.length >= 20 ? (EMA.calculate({ values: closes, period: 20 }).at(-1) ?? null) : null;

  const bbValues = closes.length >= 20 ? BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 }) : [];
  const latestBb = bbValues.at(-1) ?? null;

  const rsiSignal = latestRsi === null ? "Insufficient Data" : latestRsi > 70 ? "Overbought" : latestRsi < 30 ? "Oversold" : "Neutral";
  const macdSignal = latestMacd ? ((latestMacd.MACD ?? 0) > (latestMacd.signal ?? 0) ? "Bullish" : "Bearish") : "Insufficient Data";
  const smaSignal = currentPrice !== null && sma50 !== null ? (currentPrice > sma50 ? "Above 50 SMA" : "Below 50 SMA") : "Insufficient Data";
  const emaSignal = currentPrice !== null && ema20 !== null ? (currentPrice > ema20 ? "Above 20 EMA" : "Below 20 EMA") : "Insufficient Data";

  let bbSignal = "Insufficient Data";
  if (currentPrice !== null && latestBb) {
    if (currentPrice > latestBb.upper) bbSignal = "Overbought";
    else if (currentPrice < latestBb.lower) bbSignal = "Oversold";
    else bbSignal = "Neutral";
  }

  const candlestickPatterns = detectCandlestickPatterns(candles);
  const chartPatterns = detectChartPatterns(candles);
  const trendSignal = calculateTrendSignal([
    macdSignal,
    smaSignal,
    emaSignal,
    rsiSignal,
    bbSignal,
    candlestickPatterns.primary.bias,
    chartPatterns.primary.bias,
  ]);

  return {
    timeframe,
    currentPrice,
    rsi: latestRsi,
    rsiSignal,
    macd: latestMacd,
    macdSignal,
    sma50,
    sma100,
    sma200,
    sma250,
    smaSignal,
    ema5,
    ema10,
    ema20,
    emaSignal,
    bollingerBands: latestBb ?? null,
    bbSignal,
    candlestickPattern: candlestickPatterns.primary,
    candlestickMatches: candlestickPatterns.matches,
    chartPattern: chartPatterns.primary,
    chartPatternMatches: chartPatterns.matches,
    trendSignal,
    available: true,
  };
}

function buildUnavailableSnapshot(timeframe: string): IndicatorSnapshot {
  const emptyPattern = detectCandlestickPatterns([]).primary;
  const emptyChartPattern = detectChartPatterns([]).primary;

  return {
    timeframe,
    currentPrice: null,
    rsi: null,
    rsiSignal: "Unavailable",
    macd: null,
    macdSignal: "Unavailable",
    sma50: null,
    sma100: null,
    sma200: null,
    sma250: null,
    smaSignal: "Unavailable",
    ema5: null,
    ema10: null,
    ema20: null,
    emaSignal: "Unavailable",
    bollingerBands: null,
    bbSignal: "Unavailable",
    candlestickPattern: emptyPattern,
    candlestickMatches: [],
    chartPattern: emptyChartPattern,
    chartPatternMatches: [],
    trendSignal: "Neutral",
    available: false,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    const timeframe = searchParams.get("timeframe")?.toUpperCase();

    if (!symbol) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    const pairDef = ASSET_CATALOG.find((p) => p.symbol === symbol);
    if (!pairDef) {
      return NextResponse.json({ error: "Unsupported symbol" }, { status: 400 });
    }

    const requestedSpec = timeframe === "1H"
      ? BASE_TIMEFRAME
      : timeframe === "1D"
        ? DAILY_TIMEFRAME
        : MULTI_TIMEFRAMES.find((item) => item.key === timeframe);

    if (timeframe && !requestedSpec) {
      return NextResponse.json({ error: "Unsupported timeframe" }, { status: 400 });
    }

    const primarySpec = requestedSpec ?? BASE_TIMEFRAME;
    const primaryCandles = await fetchCandlesForTimeframe(pairDef, symbol, primarySpec);
    const primarySnapshot = calculateIndicatorSnapshot(primarySpec.key, primaryCandles);
    const multiTimeframes = await Promise.all(
      MULTI_TIMEFRAMES.map(async (spec) => {
        try {
          const candles = await fetchCandlesForTimeframe(pairDef, symbol, spec);
          return calculateIndicatorSnapshot(spec.key, candles);
        } catch {
          return buildUnavailableSnapshot(spec.key);
        }
      })
    );
    const consensusScore = calculateConsensusScore(multiTimeframes);

    return NextResponse.json({
      ...primarySnapshot,
      multiTimeframes,
      consensusScore,
    });
  } catch (error) {
    console.error("Indicators API Error:", error);
    return NextResponse.json({ 
      error: "Failed to calculate indicators", 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}
