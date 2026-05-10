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

  if (poleMove > 0.035 && consolidationSlope <= 0.002 && consolidationSlope >= -0.01 && widthRatio < 0.55) {
    matches.push(createMatch({
      key: "bullish_flag",
      name: "Bullish Flag",
      bias: "Bullish",
      confidence: 78 + poleMove * 180,
      candles: consolidation.length,
      description: "یک حرکت صعودی تند با فاز استراحت کوتاه‌مدت دیده می‌شود که می‌تواند ادامه‌ی روند رو به بالا را آماده کند.",
    }));
  }

  if (poleMove < -0.035 && consolidationSlope >= -0.002 && consolidationSlope <= 0.01 && widthRatio < 0.55) {
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

  if (highSlope < -0.0008 && lowSlope > 0.0008) {
    matches.push(createMatch({
      key: "symmetrical_triangle",
      name: "Symmetrical Triangle",
      bias: "Neutral",
      confidence: 72 + (1 - compression) * 22,
      candles: sample.length,
      description: "سقف‌ها پایین‌تر و کف‌ها بالاتر آمده‌اند؛ بازار در حال فشرده‌شدن است و منتظر شکست جهت‌دار می‌ماند.",
    }));
  }

  if (Math.abs(highSlope) < 0.0007 && lowSlope > 0.0008) {
    matches.push(createMatch({
      key: "ascending_triangle",
      name: "Ascending Triangle",
      bias: "Bullish",
      confidence: 76 + (1 - compression) * 18,
      candles: sample.length,
      description: "فشار خریداران در کف‌های بالاتر جمع می‌شود و مقاومت بالایی تقریباً ثابت مانده؛ این الگو معمولاً تمایل صعودی دارد.",
    }));
  }

  if (highSlope < -0.0008 && Math.abs(lowSlope) < 0.0007) {
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

  if (highSlope > 0.0008 && lowSlope > 0.0008 && lowSlope > highSlope * 1.1) {
    matches.push(createMatch({
      key: "rising_wedge",
      name: "Rising Wedge",
      bias: "Bearish",
      confidence: 79 + (1 - lateWidth / Math.max(earlyWidth, 1)) * 18,
      candles: sample.length,
      description: "قیمت هنوز بالا می‌رود اما دامنه‌ی حرکت جمع می‌شود؛ این الگو اغلب اخطار ضعف و شکست نزولی است.",
    }));
  }

  if (highSlope < -0.0008 && lowSlope < -0.0008 && Math.abs(highSlope) > Math.abs(lowSlope) * 1.1) {
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

  if (parallelism > 0.003 || channelWidth < 0.01 || channelWidth > 0.12) return matches;

  if (closeSlope > 0.0012) {
    matches.push(createMatch({
      key: "bullish_channel",
      name: "Bullish Channel",
      bias: "Bullish",
      confidence: 74 + Math.max(0, 0.003 - parallelism) * 4000,
      candles: sample.length,
      description: "قیمت در یک کانال صعودی منظم حرکت می‌کند و تا زمان شکست کف کانال، ساختار بازار رو به بالا باقی می‌ماند.",
    }));
  }

  if (closeSlope < -0.0012) {
    matches.push(createMatch({
      key: "bearish_channel",
      name: "Bearish Channel",
      bias: "Bearish",
      confidence: 74 + Math.max(0, 0.003 - parallelism) * 4000,
      candles: sample.length,
      description: "حرکت قیمت در یک کانال نزولی منظم نشان می‌دهد فروشندگان هنوز کنترل ساختار کوتاه‌مدت را در دست دارند.",
    }));
  }

  return matches;
}

export function detectChartPatterns(candles: Candle[]) {
  const validCandles = candles.filter((candle) => [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value)));
  const matches = [
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
