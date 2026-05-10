export interface Candle {
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
      description: "بدنه‌ی کندل خیلی کوچک است و بازار در این لحظه حالت بلاتکلیف و تردید دارد.",
    }));
  }

  if (bodyRatio <= 0.12 && lowerRatio >= 0.6 && upperRatio <= 0.12) {
    matches.push(createMatch({
      key: "dragonfly_doji",
      name: "Dragonfly Doji",
      bias: "Bullish",
      confidence: 76 + lowerRatio * 18,
      candles: 1,
      description: "سایه‌ی پایینی بلند و بدنه‌ی نزدیک سقف نشان می‌دهد فشار فروش جمع شده و احتمال برگشت صعودی وجود دارد.",
    }));
  }

  if (bodyRatio <= 0.12 && upperRatio >= 0.6 && lowerRatio <= 0.12) {
    matches.push(createMatch({
      key: "gravestone_doji",
      name: "Gravestone Doji",
      bias: "Bearish",
      confidence: 76 + upperRatio * 18,
      candles: 1,
      description: "سایه‌ی بالایی بلند و بسته‌شدن نزدیک کف می‌تواند نشانه‌ی رد شدن قیمت و ضعف خریداران باشد.",
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
        ? "بعد از یک حرکت صعودی، این ساختار می‌تواند هشدار خستگی روند و ریسک برگشت نزولی باشد."
        : "سایه‌ی پایینی بلند و بسته‌شدن بالاتر می‌تواند نشانه‌ی جمع‌آوری قیمت و برگشت صعودی باشد.",
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
        ? "سایه‌ی بالایی بلند بعد از رشد می‌تواند نشان دهد فروشندگان سقف را پس زده‌اند."
        : "در انتهای افت، این فرم می‌تواند اولین نشانه‌ی تلاش خریداران برای برگشت باشد.",
    }));
  }

  if (bodyRatio >= 0.15 && bodyRatio <= 0.38 && upperRatio >= 0.2 && lowerRatio >= 0.2) {
    matches.push(createMatch({
      key: isBullish(candle) ? "bullish_spinning_top" : "bearish_spinning_top",
      name: isBullish(candle) ? "Bullish Spinning Top" : "Bearish Spinning Top",
      bias: "Neutral",
      confidence: 58 + (0.38 - bodyRatio) * 80,
      candles: 1,
      description: "بدنه‌ی کوچک با دو سایه نشان‌دهنده‌ی نوسان بالا و عدم قطعیت کوتاه‌مدت بازار است.",
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
      description: "کندل صعودی بدنه‌ی کندل نزولی قبلی را پوشانده و می‌تواند نشانه‌ی چرخش قدرت به نفع خریداران باشد.",
    }));
  }

  if (isBullish(prev) && isBearish(curr) && currBodyHigh >= prevBodyHigh && currBodyLow <= prevBodyLow) {
    matches.push(createMatch({
      key: "bearish_engulfing",
      name: "Bearish Engulfing",
      bias: "Bearish",
      confidence: 84,
      candles: 2,
      description: "کندل نزولی بدنه‌ی کندل قبلی را کاملاً پوشانده و احتمال تغییر مومنتوم به سمت فروشندگان را بالا می‌برد.",
    }));
  }

  if (isBearish(prev) && isBullish(curr) && curr.open < prev.close && curr.close > midpoint(prev.open, prev.close) && curr.close < prev.open) {
    matches.push(createMatch({
      key: "piercing_line",
      name: "Piercing Line",
      bias: "Bullish",
      confidence: 78,
      candles: 2,
      description: "بازگشت پرقدرت کندل دوم به داخل بدنه‌ی کندل نزولی قبلی، نشانه‌ای از تضعیف فشار فروش است.",
    }));
  }

  if (isBullish(prev) && isBearish(curr) && curr.open > prev.close && curr.close < midpoint(prev.open, prev.close) && curr.close > prev.open) {
    matches.push(createMatch({
      key: "dark_cloud_cover",
      name: "Dark Cloud Cover",
      bias: "Bearish",
      confidence: 78,
      candles: 2,
      description: "نفوذ عمیق کندل نزولی به بدنه‌ی صعودی قبلی می‌تواند نشانه‌ی شروع فشار فروش باشد.",
    }));
  }

  if (isBearish(prev) && isBullish(curr) && currBodyHigh <= prevBodyHigh && currBodyLow >= prevBodyLow) {
    matches.push(createMatch({
      key: "bullish_harami",
      name: "Bullish Harami",
      bias: "Bullish",
      confidence: 72,
      candles: 2,
      description: "بدنه‌ی کوچک صعودی در دل کندل نزولی قبلی دیده می‌شود و از کاهش فشار فروش خبر می‌دهد.",
    }));
  }

  if (isBullish(prev) && isBearish(curr) && currBodyHigh <= prevBodyHigh && currBodyLow >= prevBodyLow) {
    matches.push(createMatch({
      key: "bearish_harami",
      name: "Bearish Harami",
      bias: "Bearish",
      confidence: 72,
      candles: 2,
      description: "بدنه‌ی کوچک نزولی داخل بدنه‌ی صعودی قبلی می‌تواند نشانه‌ی ضعف ادامه‌ی رشد باشد.",
    }));
  }

  if (isBearish(prev) && isBullish(curr) && equalLevel(prev.low, curr.low, tolerance)) {
    matches.push(createMatch({
      key: "tweezer_bottom",
      name: "Tweezer Bottom",
      bias: "Bullish",
      confidence: 74,
      candles: 2,
      description: "دو کف نزدیک به هم شکل گرفته و می‌تواند نشان دهد فروشندگان در ناحیه‌ی فعلی به مقاومت برخورد کرده‌اند.",
    }));
  }

  if (isBullish(prev) && isBearish(curr) && equalLevel(prev.high, curr.high, tolerance)) {
    matches.push(createMatch({
      key: "tweezer_top",
      name: "Tweezer Top",
      bias: "Bearish",
      confidence: 74,
      candles: 2,
      description: "دو سقف نزدیک به هم دیده می‌شود که معمولاً هشداری برای توقف یا برگشت روند صعودی است.",
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
      description: "الگوی سه‌ کندلی برگشتی که از تضعیف فروش و بازگشت کنترل به سمت خریداران خبر می‌دهد.",
    }));
  }

  if (isBullish(first) && secondSmall && isBearish(third) && third.close < firstMid) {
    matches.push(createMatch({
      key: "evening_star",
      name: "Evening Star",
      bias: "Bearish",
      confidence: 86,
      candles: 3,
      description: "این ساختار سه‌ کندلی معمولاً هشداری برای پایان رشد و افزایش احتمال برگشت نزولی است.",
    }));
  }

  if (isBullish(first) && isBullish(second) && isBullish(third) && second.close > first.close && third.close > second.close) {
    matches.push(createMatch({
      key: "three_white_soldiers",
      name: "Three White Soldiers",
      bias: "Bullish",
      confidence: 88,
      candles: 3,
      description: "سه کندل صعودی پیاپی با بسته‌شدن‌های بالاتر، مومنتوم مثبت و ادامه‌ی قدرت خریداران را نشان می‌دهد.",
    }));
  }

  if (isBearish(first) && isBearish(second) && isBearish(third) && second.close < first.close && third.close < second.close) {
    matches.push(createMatch({
      key: "three_black_crows",
      name: "Three Black Crows",
      bias: "Bearish",
      confidence: 88,
      candles: 3,
      description: "سه کندل نزولی متوالی با بسته‌شدن‌های پایین‌تر، غالب بودن فروشندگان را تأیید می‌کند.",
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
      description: "هارامی صعودی که با کندل سوم تأیید شده و احتمال برگشت صعودی را بیشتر می‌کند.",
    }));
  }

  if (isBullish(first) && isBearish(second) && secondInsideFirst && third.close < first.open) {
    matches.push(createMatch({
      key: "three_inside_down",
      name: "Three Inside Down",
      bias: "Bearish",
      confidence: 82,
      candles: 3,
      description: "هارامی نزولی همراه با تأیید کندل سوم، اخطار جدی‌تری برای برگشت نزولی می‌سازد.",
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
      description: "انگلفینگ صعودی که با ادامه‌ی رشد در کندل سوم تأیید شده و اعتبار بیشتری دارد.",
    }));
  }

  if (isBullish(first) && isBearish(second) && secondEngulfsFirst && third.close < second.close) {
    matches.push(createMatch({
      key: "three_outside_down",
      name: "Three Outside Down",
      bias: "Bearish",
      confidence: 84,
      candles: 3,
      description: "انگلفینگ نزولی با تأیید کندل سوم، احتمال ادامه‌ی افت را تقویت می‌کند.",
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
        description: "در کندل‌های آخر الگوی واضح و قابل اتکایی دیده نمی‌شود و بهتر است تأیید بیشتری گرفته شود.",
      }),
      matches: [] as CandlestickPatternMatch[],
    };
  }

  return {
    primary: uniqueMatches[0],
    matches: uniqueMatches.slice(0, 4),
  };
}
