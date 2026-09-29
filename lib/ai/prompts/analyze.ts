/**
 * Strategy-report prompt. Pure and unit-tested (tests/unit/analyzePrompt.test.ts).
 * All market data is computed server-side; the client only chooses symbol + timeframe and
 * contributes (length-capped) lesson text. Missing data is stated as "unavailable" so the model
 * is never nudged to invent it.
 */
import { z } from "zod";

// ─── Lessons (client-supplied, therefore untrusted) ──────────────────────────

const clip = (max: number) =>
  z.coerce.string().transform((s) => s.replace(/\s+/g, " ").replace(/#+/g, "").trim().slice(0, max));

const PastLesson = z.object({
  symbol: clip(20).optional(),
  position: clip(10).optional(),
  outcome: clip(12).optional(),
  pnlPercent: z.coerce.number().finite().optional().catch(undefined),
  rootCause: clip(400).optional(),
  lesson: clip(400).optional(),
  tags: z.array(clip(30)).optional().transform((a) => a?.slice(0, 6)),
});
const ChartLesson = z.object({
  symbol: clip(20).optional(),
  signal: clip(8).optional(),
  confluenceScore: z.coerce.number().finite().optional().catch(undefined),
  lesson: clip(400).optional(),
  patterns: z.array(clip(40)).optional().transform((a) => a?.slice(0, 6)),
  tags: z.array(clip(30)).optional().transform((a) => a?.slice(0, 6)),
});
export type SanitizedPastLesson = z.output<typeof PastLesson>;
export type SanitizedChartLesson = z.output<typeof ChartLesson>;

const keepValid = <S extends z.ZodType>(schema: S, items: unknown, max: number): z.output<S>[] =>
  (Array.isArray(items) ? items : [])
    .slice(0, max * 2)
    .flatMap((i) => { const p = schema.safeParse(i); return p.success ? [p.data] : []; })
    .slice(0, max);

export function sanitizeLessons(input: { pastLessons?: unknown; chartLessons?: unknown }) {
  return {
    pastLessons: keepValid(PastLesson, input.pastLessons, 6),
    chartLessons: keepValid(ChartLesson, input.chartLessons, 5),
  };
}

// ─── Context ─────────────────────────────────────────────────────────────────

type Pattern = { name: string; bias: string; description?: string; confidence?: number };

export interface AnalyzeContext {
  symbol: string;
  assetName: string;
  timeframe: string;
  quote: { price: number; changePct: number | null; source: string; asOf: string } | null;
  headlines: string[];
  report: {
    rsi: number | null; rsiSignal: string;
    macd: { MACD?: number; signal?: number } | null; macdSignal: string;
    sma50: number | null; sma100: number | null; sma200: number | null; sma250: number | null;
    ema5: number | null; ema10: number | null; ema20: number | null;
    bollingerBands: { lower: number; middle: number; upper: number } | null; bbSignal: string;
    atr: number | null;
    trendSignal: string; stretchSignal: string;
    candlestickPattern?: Pattern;
    chartPatternMatches?: Pattern[];
    chartPattern?: Pattern;
    multiTimeframes: Array<{
      timeframe: string; available: boolean; trendSignal: string; stretchSignal?: string;
      rsiSignal: string; macdSignal: string; emaSignal: string; atr: number | null;
    }>;
    consensusScore: {
      netScore: number; dominantBias: string; bullishPressure: number; bearishPressure: number;
      coverage: number; confluenceStrength: string;
    };
  };
  futures: { fundingRatePct: number | null; openInterestUsd: number | null; longPct: number | null; shortPct: number | null; source: string } | null;
  balanceSheet: { marketCap: number | null; fdv: number | null } | null;
  cashflow: { fees24h: number | null; revenue24h: number | null } | null;
  pastLessons: SanitizedPastLesson[];
  chartLessons: SanitizedChartLesson[];
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const NA = "unavailable";
const n = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? NA : String(Number(v.toPrecision(8))));
const pct1 = (v: number | null | undefined) => (v === null || v === undefined ? NA : `${v.toFixed(1)}%`);
const usd = (v: number | null | undefined) => {
  if (v === null || v === undefined) return NA;
  const a = Math.abs(v);
  return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v)}`;
};
const lines = (items: string[], empty: string) => (items.length ? items.join("\n") : empty);

// ─── Prompt ──────────────────────────────────────────────────────────────────

const INSTRUCTIONS = `## ROLE
You are a disciplined crypto and TradFi trader and risk manager, fluent in classical technical analysis and Smart Money Concepts (SMC).

## TASK
Produce the single best actionable plan for the selected timeframe from the DATA section only.
- If indicators conflict, the market is choppy, or higher and lower timeframes disagree ("Conflicting" confluence), answer HOLD and explain what would change your mind. Never force a trade.
- Trend and stretch are separate readings: an Overbought/Oversold stretch warns about entry timing and pullback risk; it does not by itself reverse a trend.
- Treat every "unavailable" value as unknown. Never invent prices, levels, funding, or news.
- When ATR is available, the stop loss must be entry ± 1.5 × ATR (buffer given in DATA), adjusted only to sit beyond an obvious structure level.
- BUY: stopLoss < entry < takeProfit. SELL: takeProfit < entry < stopLoss. HOLD: set entry to the current price and stopLoss/takeProfit to the levels you would use if the setup confirms.
- Use the trader's past lessons as personal memory: avoid repeated mistakes, cite a lesson in "reasoning" when it directly applies.

Moving-average map: EMA5 momentum · EMA10 short-term trend · EMA20 mean reversion · SMA50 trend support · SMA100 dip-buy zone · SMA200 trend shift · SMA250 fair value.
SMC: Order Block = last opposing candle before an impulse (demand/supply zone). Fair Value Gap = imbalance price tends to revisit.

## OUTPUT
Return ONLY a JSON object with exactly these keys:
- "signal": "BUY" | "SELL" | "HOLD"
- "confidence": number 0–100 (probability the plan works as written)
- "timeframe": the timeframe the plan is built for, e.g. "4H"
- "tradeStyle": "Scalp" | "Day Trade" | "Swing"
- "entry", "stopLoss", "takeProfit": numbers
- "risk_management": { "leverage", "leverageReasoning", "positionSize", "sizeReasoning", "riskRewardRatio", "distanceToTarget" } (all strings)
- "supportResistance": { "support": up to 3 numbers nearest first, "resistance": up to 3 numbers nearest first }
- "safeEntries": 1–3 objects { "price": number, "reasoning": string }
- "reasoning": one paragraph explaining how the data led to the decision
- "indicators_breakdown": exactly 5 objects for RSI, MACD, SMA, EMA, Bollinger Bands, each { "name", "value", "signal": "Bullish" | "Bearish" | "Neutral", "explanation" }`;

export function buildAnalyzePrompt(ctx: AnalyzeContext): string {
  const r = ctx.report;
  const price = ctx.quote?.price ?? null;
  const atrBuffer = r.atr !== null ? n(r.atr * 1.5) : null;

  const patterns = (r.chartPatternMatches?.length ? r.chartPatternMatches : r.chartPattern ? [r.chartPattern] : [])
    .map((p) => `- ${p.name} (${p.bias}${p.confidence !== undefined ? `, ${p.confidence}% heuristic` : ""}): ${p.description ?? ""}`.trim());

  const mtf = r.multiTimeframes.map((t) =>
    t.available
      ? `- ${t.timeframe}: trend ${t.trendSignal} | stretch ${t.stretchSignal ?? "Neutral"} | RSI ${t.rsiSignal} | MACD ${t.macdSignal} | ${t.emaSignal} | ATR ${n(t.atr)}`
      : `- ${t.timeframe}: unavailable`,
  );

  const past = ctx.pastLessons.map((l, i) =>
    `${i + 1}. [${l.outcome ?? "?"} · ${l.symbol ?? "?"} · ${l.position ?? "?"} · ${l.pnlPercent !== undefined ? `${l.pnlPercent.toFixed(2)}%` : "n/a"}] ${l.rootCause ?? ""} → Lesson: ${l.lesson ?? ""}${l.tags?.length ? ` (tags: ${l.tags.join(", ")})` : ""}`);
  const chart = ctx.chartLessons.map((l, i) =>
    `${i + 1}. [Chart study · ${l.signal ?? "?"} · confluence ${l.confluenceScore ?? "n/a"}/100${l.symbol ? ` · ${l.symbol}` : ""}] Patterns: ${l.patterns?.join(", ") || "n/a"}. Lesson: ${l.lesson ?? ""}`);

  const data = [
    "## DATA",
    `Asset: ${ctx.assetName} (${ctx.symbol})`,
    `Selected timeframe: ${ctx.timeframe}`,
    `Current price: ${n(price)}${ctx.quote ? ` (source ${ctx.quote.source}, as of ${ctx.quote.asOf})` : ""}`,
    `24h change: ${ctx.quote?.changePct === null || ctx.quote?.changePct === undefined ? NA : `${ctx.quote.changePct.toFixed(2)}%`}`,
    "",
    `### Indicators (${ctx.timeframe})`,
    `Trend: ${r.trendSignal} | Stretch: ${r.stretchSignal}`,
    `RSI (14): ${n(r.rsi)} (${r.rsiSignal})`,
    `MACD (12,26,9): ${n(r.macd?.MACD)} vs signal ${n(r.macd?.signal)} (${r.macdSignal})`,
    `SMA 50/100/200/250: ${n(r.sma50)} / ${n(r.sma100)} / ${n(r.sma200)} / ${n(r.sma250)}`,
    `EMA 5/10/20: ${n(r.ema5)} / ${n(r.ema10)} / ${n(r.ema20)}`,
    `Bollinger (20,2): lower ${n(r.bollingerBands?.lower)} | middle ${n(r.bollingerBands?.middle)} | upper ${n(r.bollingerBands?.upper)} (${r.bbSignal})`,
    `ATR (14): ${n(r.atr)}${atrBuffer ? ` | ATR x1.5 stop buffer: ${atrBuffer}` : ""}`,
    `Candlestick pattern: ${r.candlestickPattern ? `${r.candlestickPattern.name} (${r.candlestickPattern.bias}) — ${r.candlestickPattern.description ?? ""}` : NA}`,
    "",
    "### Chart patterns and SMC structures",
    lines(patterns, "- none detected"),
    "",
    "### Multi-timeframe",
    lines(mtf, "- unavailable"),
    `Consensus: ${r.consensusScore.netScore}/100 (${r.consensusScore.dominantBias}) | bull ${r.consensusScore.bullishPressure}% vs bear ${r.consensusScore.bearishPressure}% | coverage ${r.consensusScore.coverage}%`,
    `Confluence: ${r.consensusScore.confluenceStrength}${r.consensusScore.confluenceStrength === "Conflicting" ? " — higher and lower timeframes disagree; favour HOLD" : ""}`,
    "",
    "### Derivatives",
    ctx.futures
      ? [
          `Funding rate: ${ctx.futures.fundingRatePct === null ? NA : `${n(ctx.futures.fundingRatePct)}%`} (source ${ctx.futures.source})`,
          `Open interest: ${usd(ctx.futures.openInterestUsd)}`,
          `Long/short accounts: ${ctx.futures.longPct === null ? NA : `${pct1(ctx.futures.longPct)} / ${pct1(ctx.futures.shortPct)}`}`,
        ].join("\n")
      : "Derivatives: unavailable",
    "",
    "### Fundamentals",
    ctx.balanceSheet ? `Market cap: ${usd(ctx.balanceSheet.marketCap)} | FDV: ${usd(ctx.balanceSheet.fdv)}` : "Balance sheet: unavailable",
    ctx.cashflow ? `Fees 24h: ${usd(ctx.cashflow.fees24h)} | Revenue 24h: ${usd(ctx.cashflow.revenue24h)}` : "Cashflow: unavailable",
    "",
    "### Recent headlines",
    lines(ctx.headlines.map((h) => `- ${h.replace(/\s+/g, " ").slice(0, 200)}`), "- none available"),
    "",
    "### Trader's post-mortem lessons",
    lines(past, "- none recorded"),
    "",
    "### Trader's chart-academy lessons",
    lines(chart, "- none recorded"),
  ];

  return `${INSTRUCTIONS}\n\n${data.join("\n")}\n`;
}
