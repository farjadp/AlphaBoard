/**
 * Pure indicator engine. No I/O here — everything is unit-tested in tests/unit/indicators.test.ts.
 *
 * Two independent readings per timeframe:
 *  - trendSignal:   direction (MACD vs signal, price vs SMA50/EMA20, pattern biases)
 *  - stretchSignal: mean-reversion risk (RSI 70/30, Bollinger band breaks)
 * v1 summed both into one score, so an overbought RSI in a strong uptrend dragged the trend toward
 * "Neutral". They answer different questions and are now reported separately.
 */
import { RSI, MACD, SMA, EMA, BollingerBands } from "technicalindicators";
import { detectCandlestickPatterns, type Candle } from "@/lib/candlestickPatterns";
import { detectChartPatterns } from "@/lib/chartPatterns";
import { CONSENSUS_WEIGHTS, HTF_KEYS, LTF_KEYS } from "./timeframes";

export type TrendSignal = "Bullish" | "Bearish" | "Neutral";
export type StretchSignal = "Overbought" | "Oversold" | "Neutral";

/** MACD(12,26,9) needs 26 + 9 candles to produce its first signal value. */
export const MIN_BARS = 35;

type CandlestickResult = ReturnType<typeof detectCandlestickPatterns>;
type ChartResult = ReturnType<typeof detectChartPatterns>;

export interface IndicatorSnapshot {
  timeframe: string;
  available: boolean;
  unavailableReason?: string;
  candleCount: number;
  lastCandleTime: number | null;
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
  atr: number | null;
  candlestickPattern: CandlestickResult["primary"];
  candlestickMatches: CandlestickResult["matches"];
  chartPattern: ChartResult["primary"];
  chartPatternMatches: ChartResult["matches"];
  trendSignal: TrendSignal;
  stretchSignal: StretchSignal;
}

export interface ConsensusScore {
  bullishPressure: number;
  bearishPressure: number;
  netScore: number;
  dominantBias: TrendSignal;
  coverage: number;
  confluenceStrength: "Strong" | "Moderate" | "Weak" | "Conflicting";
}

// ─── Scoring primitives ──────────────────────────────────────────────────────

function direction(signal: string | undefined): -1 | 0 | 1 {
  if (!signal) return 0;
  if (signal === "Bullish" || signal.startsWith("Above")) return 1;
  if (signal === "Bearish" || signal.startsWith("Below")) return -1;
  return 0;
}

export function calculateTrendSignal(parts: {
  macd: string; sma: string; ema: string; candlestick: string; chartPattern: string;
}): TrendSignal {
  const score = direction(parts.macd) + direction(parts.sma) + direction(parts.ema)
    + direction(parts.candlestick) + direction(parts.chartPattern);
  if (score >= 2) return "Bullish";
  if (score <= -2) return "Bearish";
  return "Neutral";
}

export function calculateStretchSignal(rsiSignal: string, bbSignal: string): StretchSignal {
  const signals = [rsiSignal, bbSignal];
  const over = signals.includes("Overbought");
  const under = signals.includes("Oversold");
  if (over && !under) return "Overbought";
  if (under && !over) return "Oversold";
  return "Neutral";
}

export function computeAtr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const c = candles[i];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  let atr = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < tr.length; i++) atr = (atr * (period - 1) + tr[i]) / period;
  return atr;
}

/** Buckets candles into fixed UTC windows (e.g. 60m → 4h). Candles without `time` are ignored. */
export function aggregateCandlesByTime(candles: Candle[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  let current: Candle | null = null;
  for (const c of candles) {
    if (c.time === undefined) continue;
    const bucket = Math.floor(c.time / bucketMs) * bucketMs;
    if (!current || current.time !== bucket) {
      current = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close };
      out.push(current);
    } else {
      current.high = Math.max(current.high, c.high);
      current.low = Math.min(current.low, c.low);
      current.close = c.close;
    }
  }
  return out;
}

/** Round to a precision that suits the instrument's magnitude (BTC vs PEPE vs EUR/USD). */
export function roundForPrice(value: number, reference: number | null): number {
  const ref = Math.abs(reference ?? value);
  const decimals = ref >= 1000 ? 2 : ref >= 1 ? 4 : ref >= 0.01 ? 6 : 10;
  return Number(value.toFixed(decimals));
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

const lastOf = (values: number[]) => (values.length ? values[values.length - 1] : null);

export function unavailableSnapshot(timeframe: string, reason: string): IndicatorSnapshot {
  return {
    timeframe,
    available: false,
    unavailableReason: reason,
    candleCount: 0,
    lastCandleTime: null,
    currentPrice: null,
    rsi: null,
    rsiSignal: "Unavailable",
    macd: null,
    macdSignal: "Unavailable",
    sma50: null, sma100: null, sma200: null, sma250: null,
    smaSignal: "Unavailable",
    ema5: null, ema10: null, ema20: null,
    emaSignal: "Unavailable",
    bollingerBands: null,
    bbSignal: "Unavailable",
    atr: null,
    candlestickPattern: detectCandlestickPatterns([]).primary,
    candlestickMatches: [],
    chartPattern: detectChartPatterns([]).primary,
    chartPatternMatches: [],
    trendSignal: "Neutral",
    stretchSignal: "Neutral",
  };
}

export function calculateIndicatorSnapshot(timeframe: string, input: Candle[]): IndicatorSnapshot {
  const candles = input.filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite));
  if (candles.length < MIN_BARS) {
    return {
      ...unavailableSnapshot(timeframe, `Only ${candles.length} candles available (need ${MIN_BARS})`),
      candleCount: candles.length,
    };
  }

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const r = (v: number | null) => (v === null ? null : roundForPrice(v, price));

  const rsi = lastOf(RSI.calculate({ values: closes, period: 14 }));
  const macdRow = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  }).at(-1) ?? null;
  const sma = (p: number) => (closes.length >= p ? lastOf(SMA.calculate({ values: closes, period: p })) : null);
  const ema = (p: number) => (closes.length >= p ? lastOf(EMA.calculate({ values: closes, period: p })) : null);
  const sma50 = sma(50), sma100 = sma(100), sma200 = sma(200), sma250 = sma(250);
  const ema5 = ema(5), ema10 = ema(10), ema20 = ema(20);
  const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 }).at(-1) ?? null;
  const atr = computeAtr(candles);

  const rsiSignal = rsi === null ? "Insufficient Data" : rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : "Neutral";

  let macdSignal = "Insufficient Data";
  if (macdRow && macdRow.MACD !== undefined && macdRow.signal !== undefined) {
    const hist = macdRow.MACD - macdRow.signal;
    const epsilon = Math.abs(price) * 1e-9;
    macdSignal = hist > epsilon ? "Bullish" : hist < -epsilon ? "Bearish" : "Neutral";
  }
  const smaSignal = sma50 === null ? "Insufficient Data" : price > sma50 ? "Above 50 SMA" : "Below 50 SMA";
  const emaSignal = ema20 === null ? "Insufficient Data" : price > ema20 ? "Above 20 EMA" : "Below 20 EMA";
  const bbSignal = !bb ? "Insufficient Data" : price > bb.upper ? "Overbought" : price < bb.lower ? "Oversold" : "Neutral";

  const candlestick = detectCandlestickPatterns(candles);
  const chart = detectChartPatterns(candles);

  return {
    timeframe,
    available: true,
    candleCount: candles.length,
    lastCandleTime: candles[candles.length - 1].time ?? null,
    currentPrice: price,
    rsi: rsi === null ? null : Number(rsi.toFixed(2)),
    rsiSignal,
    macd: macdRow
      ? { MACD: r(macdRow.MACD ?? null) ?? undefined, signal: r(macdRow.signal ?? null) ?? undefined, histogram: r(macdRow.histogram ?? null) ?? undefined }
      : null,
    macdSignal,
    sma50: r(sma50), sma100: r(sma100), sma200: r(sma200), sma250: r(sma250),
    smaSignal,
    ema5: r(ema5), ema10: r(ema10), ema20: r(ema20),
    emaSignal,
    bollingerBands: bb ? { lower: r(bb.lower)!, middle: r(bb.middle)!, upper: r(bb.upper)!, pb: bb.pb } : null,
    bbSignal,
    atr: r(atr),
    candlestickPattern: candlestick.primary,
    candlestickMatches: candlestick.matches,
    chartPattern: chart.primary,
    chartPatternMatches: chart.matches,
    trendSignal: calculateTrendSignal({
      macd: macdSignal, sma: smaSignal, ema: emaSignal,
      candlestick: candlestick.primary.bias, chartPattern: chart.primary.bias,
    }),
    stretchSignal: calculateStretchSignal(rsiSignal, bbSignal),
  };
}

// ─── Multi-timeframe consensus ───────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const round1 = (v: number) => Math.round(v * 10) / 10;

function groupBias(signals: TrendSignal[]): TrendSignal | null {
  const directional = signals.filter((s) => s !== "Neutral");
  if (directional.length === 0) return null;
  const bulls = directional.filter((s) => s === "Bullish").length;
  if (bulls * 2 === directional.length) return null; // tie → no clear bias
  return bulls * 2 > directional.length ? "Bullish" : "Bearish";
}

/**
 * Weighted vote over available timeframes, then a top-down confluence check:
 * HTF (1W, 1D) agreeing with LTF (4H, 1H) → +5 bonus; disagreeing → −8 toward neutral and "Conflicting".
 */
export function calculateConsensusScore(
  snapshots: Array<Pick<IndicatorSnapshot, "timeframe" | "available" | "trendSignal">>,
): ConsensusScore {
  const available = snapshots.filter((s) => s.available);
  const w = (tf: string) => CONSENSUS_WEIGHTS[tf] ?? 1;
  const total = available.reduce((sum, s) => sum + w(s.timeframe), 0);

  if (available.length === 0 || total === 0) {
    return { bullishPressure: 50, bearishPressure: 50, netScore: 50, dominantBias: "Neutral", coverage: 0, confluenceStrength: "Weak" };
  }

  const sumFor = (sig: TrendSignal) => available.filter((s) => s.trendSignal === sig).reduce((acc, s) => acc + w(s.timeframe), 0);
  const bull = sumFor("Bullish");
  const bear = sumFor("Bearish");
  const neutral = sumFor("Neutral");

  const bullishPressure = clamp(round1(((bull + neutral * 0.5) / total) * 100), 0, 100);
  const bearishPressure = clamp(round1(((bear + neutral * 0.5) / total) * 100), 0, 100);
  let netScore = clamp(round1(50 + ((bull - bear) / total) * 50), 0, 100);

  const htf = groupBias(available.filter((s) => HTF_KEYS.has(s.timeframe)).map((s) => s.trendSignal));
  const ltf = groupBias(available.filter((s) => LTF_KEYS.has(s.timeframe)).map((s) => s.trendSignal));

  let confluenceStrength: ConsensusScore["confluenceStrength"] = "Weak";
  if (htf && ltf) {
    if (htf === ltf) {
      netScore = clamp(netScore + (htf === "Bullish" ? 5 : -5), 0, 100);
      confluenceStrength = Math.abs(netScore - 50) >= 10 ? "Strong" : "Moderate";
    } else {
      netScore = clamp(netScore > 50 ? Math.max(50, netScore - 8) : Math.min(50, netScore + 8), 0, 100);
      confluenceStrength = "Conflicting";
    }
  } else if (htf || ltf) {
    confluenceStrength = "Moderate";
  }

  return {
    bullishPressure,
    bearishPressure,
    netScore: round1(netScore),
    dominantBias: netScore >= 57 ? "Bullish" : netScore <= 43 ? "Bearish" : "Neutral",
    coverage: Math.round((available.length / snapshots.length) * 100),
    confluenceStrength,
  };
}
