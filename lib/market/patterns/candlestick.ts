export interface Candle {
  time?: number; // candle open time, epoch ms (optional for legacy callers)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandlestickPatternMatch {
  key: string;
  name: string;
  bias: "Bullish" | "Bearish" | "Neutral";
  confidence: number;
  candles: number;
  description: string;
}

function bodySize(candle: Candle) {
  return Math.abs(candle.close - candle.open);
}

function candleRange(candle: Candle) {
  return Math.max(candle.high - candle.low, 0.0000001);
}

function upperWick(candle: Candle) {
  return candle.high - Math.max(candle.open, candle.close);
}

function lowerWick(candle: Candle) {
  return Math.min(candle.open, candle.close) - candle.low;
}

function isBullish(candle: Candle) {
  return candle.close > candle.open;
}

function isBearish(candle: Candle) {
  return candle.close < candle.open;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function midpoint(a: number, b: number) {
  return (a + b) / 2;
}

function getPriorTrend(candles: Candle[]) {
  if (candles.length < 4) return "sideways" as const;
  const sample = candles.slice(-4, -1);
  const first = sample[0]?.close ?? 0;
  const last = sample[sample.length - 1]?.close ?? 0;
  const gains = sample.slice(1).filter((c, idx) => c.close >= sample[idx].close).length;
  const losses = sample.slice(1).filter((c, idx) => c.close <= sample[idx].close).length;

  if (last > first && gains >= 2) return "up" as const;
  if (last < first && losses >= 2) return "down" as const;
  return "sideways" as const;
}

function equalLevel(a: number, b: number, tolerance: number) {
  return Math.abs(a - b) <= tolerance;
}

function createMatch(match: CandlestickPatternMatch) {
  return {
    ...match,
    confidence: clamp(Number(match.confidence.toFixed(0)), 1, 99),
  };
}

function detectSingleCandlePatterns(candles: Candle[]) {
  const matches: CandlestickPatternMatch[] = [];
  const candle = candles[candles.length - 1];
  if (!candle) return matches;

  const range = candleRange(candle);
  const body = bodySize(candle);
  const upper = upperWick(candle);
  const lower = lowerWick(candle);
  const bodyRatio = body / range;
  const upperRatio = upper / range;
  const lowerRatio = lower / range;
  const trend = getPriorTrend(candles);

  if (bodyRatio <= 0.1) {
    matches.push(createMatch({
      key: "doji",
      name: "Doji",
      bias: "Neutral",
      confidence: 62 + (0.1 - bodyRatio) * 120,
      candles: 1,
      description: "Very small body: the market is undecided and momentum has stalled.",
    }));
  }

  if (bodyRatio <= 0.12 && lowerRatio >= 0.6 && upperRatio <= 0.12) {
    matches.push(createMatch({
      key: "dragonfly_doji",
      name: "Dragonfly Doji",
      bias: "Bullish",
      confidence: 76 + lowerRatio * 18,
      candles: 1,
      description: "Long lower shadow with a close near the high: selling was absorbed and a bullish reversal is possible.",
    }));
  }

  if (bodyRatio <= 0.12 && upperRatio >= 0.6 && lowerRatio <= 0.12) {
    matches.push(createMatch({
      key: "gravestone_doji",
      name: "Gravestone Doji",
      bias: "Bearish",
      confidence: 76 + upperRatio * 18,
      candles: 1,
      description: "Long upper shadow with a close near the low: price was rejected higher and buyers look weak.",
    }));
  }

  if (lower >= body * 2.2 && upper <= Math.max(body * 0.5, range * 0.12) && bodyRatio <= 0.38) {
    matches.push(createMatch({
      key: trend === "up" ? "hanging_man" : "hammer",
      name: trend === "up" ? "Hanging Man" : "Hammer",
      bias: trend === "up" ? "Bearish" : "Bullish",
      confidence: 70 + lowerRatio * 18 + (trend !== "sideways" ? 6 : 0),
      candles: 1,
      description: trend === "up"
        ? "After an advance, this shape can signal trend exhaustion and a bearish reversal risk."
        : "Long lower shadow with a higher close can signal accumulation and a bullish reversal.",
    }));
  }

  if (upper >= body * 2.2 && lower <= Math.max(body * 0.5, range * 0.12) && bodyRatio <= 0.38) {
    matches.push(createMatch({
      key: trend === "up" ? "shooting_star" : "inverted_hammer",
      name: trend === "up" ? "Shooting Star" : "Inverted Hammer",
      bias: trend === "up" ? "Bearish" : "Bullish",
      confidence: 70 + upperRatio * 18 + (trend !== "sideways" ? 6 : 0),
      candles: 1,
      description: trend === "up"
        ? "A long upper shadow after a rally can show sellers rejecting the highs."
        : "At the end of a decline, this shape can be the first sign of buyers attempting a reversal.",
    }));
  }

  if (bodyRatio >= 0.15 && bodyRatio <= 0.38 && upperRatio >= 0.2 && lowerRatio >= 0.2) {
    matches.push(createMatch({
      key: isBullish(candle) ? "bullish_spinning_top" : "bearish_spinning_top",
      name: isBullish(candle) ? "Bullish Spinning Top" : "Bearish Spinning Top",
      bias: "Neutral",
      confidence: 58 + (0.38 - bodyRatio) * 80,
      candles: 1,
      description: "Small body with two long shadows: high volatility and short-term indecision.",
    }));
  }

  return matches;
}

function detectDoubleCandlePatterns(candles: Candle[]) {
  const matches: CandlestickPatternMatch[] = [];
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  if (!prev || !curr) return matches;

  const prevBodyHigh = Math.max(prev.open, prev.close);
  const prevBodyLow = Math.min(prev.open, prev.close);
  const currBodyHigh = Math.max(curr.open, curr.close);
  const currBodyLow = Math.min(curr.open, curr.close);
  const tolerance = midpoint(candleRange(prev), candleRange(curr)) * 0.12;

  if (isBearish(prev) && isBullish(curr) && currBodyLow <= prevBodyLow && currBodyHigh >= prevBodyHigh) {
    matches.push(createMatch({
      key: "bullish_engulfing",
      name: "Bullish Engulfing",
      bias: "Bullish",
      confidence: 84,
      candles: 2,
      description: "The bullish candle's body engulfs the prior bearish body, suggesting control is shifting to buyers.",
    }));
  }

  if (isBullish(prev) && isBearish(curr) && currBodyHigh >= prevBodyHigh && currBodyLow <= prevBodyLow) {
    matches.push(createMatch({
      key: "bearish_engulfing",
      name: "Bearish Engulfing",
      bias: "Bearish",
      confidence: 84,
      candles: 2,
      description: "The bearish candle fully engulfs the prior body, raising the odds of momentum shifting to sellers.",
    }));
  }

  if (isBearish(prev) && isBullish(curr) && curr.open < prev.close && curr.close > midpoint(prev.open, prev.close) && curr.close < prev.open) {
    matches.push(createMatch({
      key: "piercing_line",
      name: "Piercing Line",
      bias: "Bullish",
      confidence: 78,
      candles: 2,
      description: "The second candle recovers deep into the prior bearish body, a sign that selling pressure is fading.",
    }));
  }

  if (isBullish(prev) && isBearish(curr) && curr.open > prev.close && curr.close < midpoint(prev.open, prev.close) && curr.close > prev.open) {
    matches.push(createMatch({
      key: "dark_cloud_cover",
      name: "Dark Cloud Cover",
      bias: "Bearish",
      confidence: 78,
      candles: 2,
      description: "A bearish candle penetrates deep into the prior bullish body, which can mark the start of selling pressure.",
    }));
  }

  if (isBearish(prev) && isBullish(curr) && currBodyHigh <= prevBodyHigh && currBodyLow >= prevBodyLow) {
    matches.push(createMatch({
      key: "bullish_harami",
      name: "Bullish Harami",
      bias: "Bullish",
      confidence: 72,
      candles: 2,
      description: "A small bullish body inside the prior bearish candle points to easing selling pressure.",
    }));
  }

  if (isBullish(prev) && isBearish(curr) && currBodyHigh <= prevBodyHigh && currBodyLow >= prevBodyLow) {
    matches.push(createMatch({
      key: "bearish_harami",
      name: "Bearish Harami",
      bias: "Bearish",
      confidence: 72,
      candles: 2,
      description: "A small bearish body inside the prior bullish candle can signal the advance is losing strength.",
    }));
  }

  if (isBearish(prev) && isBullish(curr) && equalLevel(prev.low, curr.low, tolerance)) {
    matches.push(createMatch({
      key: "tweezer_bottom",
      name: "Tweezer Bottom",
      bias: "Bullish",
      confidence: 74,
      candles: 2,
      description: "Two nearby lows suggest sellers are meeting support in this area.",
    }));
  }

  if (isBullish(prev) && isBearish(curr) && equalLevel(prev.high, curr.high, tolerance)) {
    matches.push(createMatch({
      key: "tweezer_top",
      name: "Tweezer Top",
      bias: "Bearish",
      confidence: 74,
      candles: 2,
      description: "Two nearby highs usually warn of a pause or reversal in the uptrend.",
    }));
  }

  return matches;
}

function detectTripleCandlePatterns(candles: Candle[]) {
  const matches: CandlestickPatternMatch[] = [];
  const first = candles[candles.length - 3];
  const second = candles[candles.length - 2];
  const third = candles[candles.length - 1];
  if (!first || !second || !third) return matches;

  const firstMid = midpoint(first.open, first.close);
  const secondBody = bodySize(second);
  const firstBody = bodySize(first);
  const secondSmall = secondBody <= firstBody * 0.45;

  if (isBearish(first) && secondSmall && isBullish(third) && third.close > firstMid) {
    matches.push(createMatch({
      key: "morning_star",
      name: "Morning Star",
      bias: "Bullish",
      confidence: 86,
      candles: 3,
      description: "Three-candle reversal pattern: selling fades and control returns to buyers.",
    }));
  }

  if (isBullish(first) && secondSmall && isBearish(third) && third.close < firstMid) {
    matches.push(createMatch({
      key: "evening_star",
      name: "Evening Star",
      bias: "Bearish",
      confidence: 86,
      candles: 3,
      description: "Three-candle reversal pattern that usually warns the advance is ending and a decline is more likely.",
    }));
  }

  if (isBullish(first) && isBullish(second) && isBullish(third) && second.close > first.close && third.close > second.close) {
    matches.push(createMatch({
      key: "three_white_soldiers",
      name: "Three White Soldiers",
      bias: "Bullish",
      confidence: 88,
      candles: 3,
      description: "Three consecutive bullish candles with higher closes show positive momentum and sustained buying.",
    }));
  }

  if (isBearish(first) && isBearish(second) && isBearish(third) && second.close < first.close && third.close < second.close) {
    matches.push(createMatch({
      key: "three_black_crows",
      name: "Three Black Crows",
      bias: "Bearish",
      confidence: 88,
      candles: 3,
      description: "Three consecutive bearish candles with lower closes confirm sellers are in control.",
    }));
  }

  const secondInsideFirst = Math.max(second.open, second.close) <= Math.max(first.open, first.close)
    && Math.min(second.open, second.close) >= Math.min(first.open, first.close);

  if (isBearish(first) && isBullish(second) && secondInsideFirst && third.close > first.open) {
    matches.push(createMatch({
      key: "three_inside_up",
      name: "Three Inside Up",
      bias: "Bullish",
      confidence: 82,
      candles: 3,
      description: "Bullish harami confirmed by a third candle, which strengthens the case for an upside reversal.",
    }));
  }

  if (isBullish(first) && isBearish(second) && secondInsideFirst && third.close < first.open) {
    matches.push(createMatch({
      key: "three_inside_down",
      name: "Three Inside Down",
      bias: "Bearish",
      confidence: 82,
      candles: 3,
      description: "Bearish harami confirmed by a third candle, a stronger warning of a downside reversal.",
    }));
  }

  const secondEngulfsFirst = Math.max(second.open, second.close) >= Math.max(first.open, first.close)
    && Math.min(second.open, second.close) <= Math.min(first.open, first.close);

  if (isBearish(first) && isBullish(second) && secondEngulfsFirst && third.close > second.close) {
    matches.push(createMatch({
      key: "three_outside_up",
      name: "Three Outside Up",
      bias: "Bullish",
      confidence: 84,
      candles: 3,
      description: "Bullish engulfing confirmed by follow-through on the third candle, which makes it more reliable.",
    }));
  }

  if (isBullish(first) && isBearish(second) && secondEngulfsFirst && third.close < second.close) {
    matches.push(createMatch({
      key: "three_outside_down",
      name: "Three Outside Down",
      bias: "Bearish",
      confidence: 84,
      candles: 3,
      description: "Bearish engulfing confirmed by the third candle, which strengthens the case for further downside.",
    }));
  }

  return matches;
}

export function detectCandlestickPatterns(candles: Candle[]) {
  const validCandles = candles.filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v)));
  const matches = [
    ...detectTripleCandlePatterns(validCandles),
    ...detectDoubleCandlePatterns(validCandles),
    ...detectSingleCandlePatterns(validCandles),
  ].sort((a, b) => b.confidence - a.confidence || b.candles - a.candles);

  const uniqueMatches = matches.filter((match, index) => matches.findIndex((item) => item.key === match.key) === index);

  if (uniqueMatches.length === 0) {
    return {
      primary: createMatch({
        key: "no_clear_pattern",
        name: "No Clear Pattern",
        bias: "Neutral",
        confidence: 35,
        candles: 1,
        description: "No clear, reliable pattern on the latest candles; wait for more confirmation.",
      }),
      matches: [] as CandlestickPatternMatch[],
    };
  }

  return {
    primary: uniqueMatches[0],
    matches: uniqueMatches.slice(0, 4),
  };
}
