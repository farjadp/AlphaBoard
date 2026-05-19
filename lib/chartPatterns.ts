import type { Candle } from "@/lib/candlestickPatterns";

export interface ChartPatternMatch {
  key: string;
  name: string;
  bias: "Bullish" | "Bearish" | "Neutral";
  confidence: number;
  candles: number;
  description: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function regressionSlope(values: number[]) {
  if (values.length < 2) return 0;
  const n = values.length;
  const sumX = ((n - 1) * n) / 2;
  const sumY = values.reduce((total, value) => total + value, 0);
  const sumXY = values.reduce((total, value, index) => total + index * value, 0);
  const sumXX = values.reduce((total, _, index) => total + index * index, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function relativeMove(start: number, end: number) {
  if (start === 0) return 0;
  return (end - start) / start;
}

function createMatch(match: ChartPatternMatch) {
  return {
    ...match,
    confidence: clamp(Number(match.confidence.toFixed(0)), 1, 99),
  };
}

// ─── Order Block Detection ────────────────────────────────────────────────────
// An Order Block is the last opposing candle immediately before a strong
// impulsive move. It represents an institutional footprint: a zone where large
// buy or sell orders were accumulated. Price tends to revisit these zones.
//
// Bullish OB : last bearish candle before a sharp upward impulse
// Bearish OB : last bullish candle before a sharp downward impulse
//
// Scoring: body-to-range quality × impulse magnitude × recency
function detectOrderBlocks(candles: Candle[]) {
  const matches: ChartPatternMatch[] = [];
  if (candles.length < 10) return matches;

  const LOOKBACK = Math.min(50, candles.length - 5);
  const IMPULSE_CANDLES = 4;   // candles after the OB used to measure impulse
  const MIN_IMPULSE = 1.8;     // impulse must move ≥ 1.8× the OB body size
  const MIN_BODY_RATIO = 0.35; // OB candle body must occupy ≥ 35% of its range

  const baseAvg = average(candles.map((c) => c.close));

  const bullishOBs: ChartPatternMatch[] = [];
  const bearishOBs: ChartPatternMatch[] = [];

  for (let i = candles.length - LOOKBACK; i < candles.length - IMPULSE_CANDLES - 1; i++) {
    const ob = candles[i];
    const obBody = Math.abs(ob.close - ob.open);
    const obRange = Math.max(ob.high - ob.low, 0.0001);
    if (obBody / obRange < MIN_BODY_RATIO) continue;

    const impulseCandles = candles.slice(i + 1, i + 1 + IMPULSE_CANDLES);
    const impulseHigh = Math.max(...impulseCandles.map((c) => c.high));
    const impulseLow = Math.min(...impulseCandles.map((c) => c.low));

    // Bullish Order Block: bearish OB candle followed by strong upward impulse
    if (ob.close < ob.open) {
      const upMove = impulseHigh - Math.max(ob.open, ob.close);
      if (upMove >= obBody * MIN_IMPULSE) {
        const recency = (i - (candles.length - LOOKBACK)) / Math.max(LOOKBACK, 1);
        const confidence = 74 + recency * 14 + Math.min((upMove / Math.max(baseAvg, 1)) * 800, 8);
        bullishOBs.push(createMatch({
          key: "bullish_order_block",
          name: "Bullish Order Block",
          bias: "Bullish",
          confidence,
          candles: IMPULSE_CANDLES + 1,
          description: "آخرین کندل نزولی قبل از یک حرکت صعودی قوی شناسایی شده — این ناحیه نشان‌دهنده‌ی سفارشات انباشته‌ی خریداران بزرگ است و معمولاً در بازگشت قیمت به این سطح، واکنش صعودی ایجاد می‌شود.",
        }));
      }
    }

    // Bearish Order Block: bullish OB candle followed by strong downward impulse
    if (ob.close > ob.open) {
      const downMove = Math.min(ob.open, ob.close) - impulseLow;
      if (downMove >= obBody * MIN_IMPULSE) {
        const recency = (i - (candles.length - LOOKBACK)) / Math.max(LOOKBACK, 1);
        const confidence = 74 + recency * 14 + Math.min((downMove / Math.max(baseAvg, 1)) * 800, 8);
        bearishOBs.push(createMatch({
          key: "bearish_order_block",
          name: "Bearish Order Block",
          bias: "Bearish",
          confidence,
          candles: IMPULSE_CANDLES + 1,
          description: "آخرین کندل صعودی پیش از یک ریزش تند شناسایی شده — این منطقه جایی‌ست که فروشندگان سازمانی سفارشات خود را قرار داده‌اند و قیمت در بازگشت احتمالاً با فشار فروش مواجه می‌شود.",
        }));
      }
    }
  }

  // Return only the most confident block of each type
  if (bullishOBs.length > 0) matches.push(bullishOBs.sort((a, b) => b.confidence - a.confidence)[0]);
  if (bearishOBs.length > 0) matches.push(bearishOBs.sort((a, b) => b.confidence - a.confidence)[0]);
  return matches;
}

// ─── Fair Value Gap (FVG) Detection ──────────────────────────────────────────
// An FVG is a price inefficiency created when a rapid move leaves a gap
// between the wicks of candle[i-2] and candle[i]. Market structure theory
// holds that price tends to retrace and "fill" these inefficiencies.
//
// Bullish FVG : candle[i].low > candle[i-2].high  (gap above earlier candle)
// Bearish FVG : candle[i].high < candle[i-2].low  (gap below earlier candle)
//
// Only reports gaps that are still relevant to the current price level.
function detectFairValueGaps(candles: Candle[]) {
  const matches: ChartPatternMatch[] = [];
  if (candles.length < 5) return matches;

  const LOOKBACK = Math.min(40, candles.length - 2);
  const currentPrice = candles[candles.length - 1].close;
  const baseAvg = average(candles.map((c) => c.close));

  const bullishFVGs: ChartPatternMatch[] = [];
  const bearishFVGs: ChartPatternMatch[] = [];

  for (let i = candles.length - LOOKBACK + 1; i < candles.length - 1; i++) {
    const prev2 = candles[i - 1]; // the candle two steps back (i-2 in classic notation)
    const curr  = candles[i + 1]; // the candle after the middle candle
    if (!prev2 || !curr) continue;

    // Bullish FVG: curr.low > prev2.high (gap between consecutive non-adjacent wicks)
    const bullishGap = curr.low - prev2.high;
    if (bullishGap > 0) {
      const gapMid = (curr.low + prev2.high) / 2;
      // Only relevant if current price is near or inside the gap
      if (currentPrice >= gapMid * 0.95) {
        const gapRatio = bullishGap / Math.max(baseAvg, 1);
        const recency = i / candles.length;
        const confidence = 68 + recency * 16 + Math.min(gapRatio * 1200, 10);
        bullishFVGs.push(createMatch({
          key: "bullish_fvg",
          name: "Bullish Fair Value Gap",
          bias: "Bullish",
          confidence,
          candles: 3,
          description: "یک شکاف قیمتی صعودی بین کندل‌های اخیر شناسایی شده — قیمت اغلب به این ناحیه باز می‌گردد تا «فاصله» را پر کند و این سطح می‌تواند به‌عنوان حمایت عمل کند.",
        }));
      }
    }

    // Bearish FVG: curr.high < prev2.low (gap below the earlier candle)
    const bearishGap = prev2.low - curr.high;
    if (bearishGap > 0) {
      const gapMid = (curr.high + prev2.low) / 2;
      if (currentPrice <= gapMid * 1.05) {
        const gapRatio = bearishGap / Math.max(baseAvg, 1);
        const recency = i / candles.length;
        const confidence = 68 + recency * 16 + Math.min(gapRatio * 1200, 10);
        bearishFVGs.push(createMatch({
          key: "bearish_fvg",
          name: "Bearish Fair Value Gap",
          bias: "Bearish",
          confidence,
          candles: 3,
          description: "یک شکاف قیمتی نزولی در ساختار کندل‌های اخیر دیده می‌شود — قیمت معمولاً دوباره به این ناحیه سر می‌زند و این سطح می‌تواند به‌عنوان مقاومت عمل کند.",
        }));
      }
    }
  }

  if (bullishFVGs.length > 0) matches.push(bullishFVGs.sort((a, b) => b.confidence - a.confidence)[0]);
  if (bearishFVGs.length > 0) matches.push(bearishFVGs.sort((a, b) => b.confidence - a.confidence)[0]);
  return matches;
}

function detectFlag(candles: Candle[]) {
  const matches: ChartPatternMatch[] = [];
  if (candles.length < 18) return matches;

  const pole = candles.slice(-18, -10);
  const consolidation = candles.slice(-10);
  const poleMove = relativeMove(pole[0].close, pole[pole.length - 1].close);
  const consolidationCloses = consolidation.map((candle) => candle.close);
  const consolidationSlope = regressionSlope(consolidationCloses) / Math.max(average(consolidationCloses), 1);
  const consolidationHighs = consolidation.map((candle) => candle.high);
  const consolidationLows = consolidation.map((candle) => candle.low);
  const widthRatio = (Math.max(...consolidationHighs) - Math.min(...consolidationLows)) / Math.max(Math.abs(pole[pole.length - 1].close - pole[0].close), 1);

  // Lowered poleMove threshold from 0.035 to 0.015 to include lower-volatility TradFi assets
  if (poleMove > 0.015 && consolidationSlope <= 0.003 && consolidationSlope >= -0.015 && widthRatio < 0.6) {
    matches.push(createMatch({
      key: "bullish_flag",
      name: "Bullish Flag",
      bias: "Bullish",
      confidence: 78 + poleMove * 180,
      candles: consolidation.length,
      description: "یک حرکت صعودی تند با فاز استراحت کوتاه‌مدت دیده می‌شود که می‌تواند ادامه‌ی روند رو به بالا را آماده کند.",
    }));
  }

  if (poleMove < -0.015 && consolidationSlope >= -0.003 && consolidationSlope <= 0.015 && widthRatio < 0.6) {
    matches.push(createMatch({
      key: "bearish_flag",
      name: "Bearish Flag",
      bias: "Bearish",
      confidence: 78 + Math.abs(poleMove) * 180,
      candles: consolidation.length,
      description: "افت سریع قیمت و سپس یک استراحت فشرده شکل گرفته که اغلب ادامه‌ی فشار فروش را تداعی می‌کند.",
    }));
  }

  return matches;
}

function detectTriangle(candles: Candle[]) {
  const matches: ChartPatternMatch[] = [];
  if (candles.length < 16) return matches;

  const sample = candles.slice(-16);
  const highs = sample.map((candle) => candle.high);
  const lows = sample.map((candle) => candle.low);
  const highSlope = regressionSlope(highs) / Math.max(average(highs), 1);
  const lowSlope = regressionSlope(lows) / Math.max(average(lows), 1);
  const earlyWidth = highs.slice(0, 5).reduce((max, value, index) => Math.max(max, value - lows[index]), 0);
  const lateHigh = Math.max(...highs.slice(-5));
  const lateLow = Math.min(...lows.slice(-5));
  const lateWidth = lateHigh - lateLow;
  const compression = lateWidth / Math.max(earlyWidth, 1);

  if (compression >= 0.9) return matches;

  // Lowered slope thresholds from 0.0008 to 0.0003 for TradFi compatibility
  if (highSlope < -0.0003 && lowSlope > 0.0003) {
    matches.push(createMatch({
      key: "symmetrical_triangle",
      name: "Symmetrical Triangle",
      bias: "Neutral",
      confidence: 72 + (1 - compression) * 22,
      candles: sample.length,
      description: "سقف‌ها پایین‌تر و کف‌ها بالاتر آمده‌اند؛ بازار در حال فشرده‌شدن است و منتظر شکست جهت‌دار می‌ماند.",
    }));
  }

  if (Math.abs(highSlope) < 0.0003 && lowSlope > 0.0003) {
    matches.push(createMatch({
      key: "ascending_triangle",
      name: "Ascending Triangle",
      bias: "Bullish",
      confidence: 76 + (1 - compression) * 18,
      candles: sample.length,
      description: "فشار خریداران در کف‌های بالاتر جمع می‌شود و مقاومت بالایی تقریباً ثابت مانده؛ این الگو معمولاً تمایل صعودی دارد.",
    }));
  }

  if (highSlope < -0.0003 && Math.abs(lowSlope) < 0.0003) {
    matches.push(createMatch({
      key: "descending_triangle",
      name: "Descending Triangle",
      bias: "Bearish",
      confidence: 76 + (1 - compression) * 18,
      candles: sample.length,
      description: "سقف‌ها در حال افت هستند و کف تقریباً ثابت مانده؛ فشار فروش تدریجی می‌تواند به شکست نزولی ختم شود.",
    }));
  }

  return matches;
}

function detectWedge(candles: Candle[]) {
  const matches: ChartPatternMatch[] = [];
  if (candles.length < 18) return matches;

  const sample = candles.slice(-18);
  const highs = sample.map((candle) => candle.high);
  const lows = sample.map((candle) => candle.low);
  const highSlope = regressionSlope(highs) / Math.max(average(highs), 1);
  const lowSlope = regressionSlope(lows) / Math.max(average(lows), 1);
  const earlyWidth = Math.max(...highs.slice(0, 6)) - Math.min(...lows.slice(0, 6));
  const lateWidth = Math.max(...highs.slice(-6)) - Math.min(...lows.slice(-6));
  const converging = lateWidth / Math.max(earlyWidth, 1) < 0.78;

  if (!converging) return matches;

  // Lowered slope thresholds from 0.0008 to 0.0003 for TradFi compatibility
  if (highSlope > 0.0003 && lowSlope > 0.0003 && lowSlope > highSlope * 1.08) {
    matches.push(createMatch({
      key: "rising_wedge",
      name: "Rising Wedge",
      bias: "Bearish",
      confidence: 79 + (1 - lateWidth / Math.max(earlyWidth, 1)) * 18,
      candles: sample.length,
      description: "قیمت هنوز بالا می‌رود اما دامنه‌ی حرکت جمع می‌شود؛ این الگو اغلب اخطار ضعف و شکست نزولی است.",
    }));
  }

  if (highSlope < -0.0003 && lowSlope < -0.0003 && Math.abs(highSlope) > Math.abs(lowSlope) * 1.08) {
    matches.push(createMatch({
      key: "falling_wedge",
      name: "Falling Wedge",
      bias: "Bullish",
      confidence: 79 + (1 - lateWidth / Math.max(earlyWidth, 1)) * 18,
      candles: sample.length,
      description: "افت قیمت در قالب یک دامنه‌ی فشرده در حال کند شدن است و اغلب زمینه‌ی شکست صعودی را فراهم می‌کند.",
    }));
  }

  return matches;
}

function detectChannel(candles: Candle[]) {
  const matches: ChartPatternMatch[] = [];
  if (candles.length < 14) return matches;

  const sample = candles.slice(-14);
  const highs = sample.map((candle) => candle.high);
  const lows = sample.map((candle) => candle.low);
  const closes = sample.map((candle) => candle.close);
  const highSlope = regressionSlope(highs) / Math.max(average(highs), 1);
  const lowSlope = regressionSlope(lows) / Math.max(average(lows), 1);
  const closeSlope = regressionSlope(closes) / Math.max(average(closes), 1);
  const parallelism = Math.abs(highSlope - lowSlope);
  const channelWidth = (Math.max(...highs) - Math.min(...lows)) / Math.max(average(closes), 1);

  // Relaxed parallelism and width limits for TradFi assets; lowered slope from 0.0012 to 0.0004
  if (parallelism > 0.004 || channelWidth < 0.005 || channelWidth > 0.18) return matches;

  if (closeSlope > 0.0004) {
    matches.push(createMatch({
      key: "bullish_channel",
      name: "Bullish Channel",
      bias: "Bullish",
      confidence: 74 + Math.max(0, 0.004 - parallelism) * 3000,
      candles: sample.length,
      description: "قیمت در یک کانال صعودی منظم حرکت می‌کند و تا زمان شکست کف کانال، ساختار بازار رو به بالا باقی می‌ماند.",
    }));
  }

  if (closeSlope < -0.0004) {
    matches.push(createMatch({
      key: "bearish_channel",
      name: "Bearish Channel",
      bias: "Bearish",
      confidence: 74 + Math.max(0, 0.004 - parallelism) * 3000,
      candles: sample.length,
      description: "حرکت قیمت در یک کانال نزولی منظم نشان می‌دهد فروشندگان هنوز کنترل ساختار کوتاه‌مدت را در دست دارند.",
    }));
  }

  return matches;
}

export function detectChartPatterns(candles: Candle[]) {
  const validCandles = candles.filter((candle) => [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value)));
  const matches = [
    ...detectOrderBlocks(validCandles),
    ...detectFairValueGaps(validCandles),
    ...detectFlag(validCandles),
    ...detectTriangle(validCandles),
    ...detectWedge(validCandles),
    ...detectChannel(validCandles),
  ].sort((a, b) => b.confidence - a.confidence || b.candles - a.candles);

  const uniqueMatches = matches.filter((match, index) => matches.findIndex((item) => item.key === match.key) === index);

  if (uniqueMatches.length === 0) {
    return {
      primary: createMatch({
        key: "no_clear_chart_pattern",
        name: "No Clear Chart Pattern",
        bias: "Neutral",
        confidence: 34,
        candles: Math.min(validCandles.length, 20),
        description: "در ساختار چند کندل اخیر، الگوی واضحی از نوع فلگ، مثلث، وج یا کانال دیده نمی‌شود.",
      }),
      matches: [] as ChartPatternMatch[],
    };
  }

  return {
    primary: uniqueMatches[0],
    matches: uniqueMatches.slice(0, 4),
  };
}
