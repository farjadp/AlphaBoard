/**
 * Output contracts for every AI feature. The model's JSON is untrusted input: numbers may come
 * back as strings, enums in the wrong case, levels on the wrong side of the entry.
 */
import { z } from "zod";

// ─── helpers ─────────────────────────────────────────────────────────────────

const toNumberOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const nullableNumber = z.preprocess(toNumberOrNull, z.number().nullable());
const price = z.preprocess(toNumberOrNull, z.number().nonnegative());
const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const titleCase = (v: unknown) =>
  typeof v === "string" ? v.trim().charAt(0).toUpperCase() + v.trim().slice(1).toLowerCase() : v;
const text = (max: number) => z.coerce.string().transform((s) => s.trim().slice(0, max));
const textList = (maxItems: number, maxLen = 300) =>
  z.array(z.coerce.string()).default([]).transform((a) => a.slice(0, maxItems).map((s) => s.trim().slice(0, maxLen)));

export const Signal = z.preprocess(upper, z.enum(["BUY", "SELL", "HOLD"]));
export const Bias = z.preprocess(titleCase, z.enum(["Bullish", "Bearish", "Neutral"]));
const confidence = z.preprocess(toNumberOrNull, z.number()).transform((n) => Math.round(Math.min(100, Math.max(0, n))));

// ─── Strategy report (/api/analyze) ──────────────────────────────────────────

export const AnalysisSchema = z
  .object({
    signal: Signal,
    confidence,
    timeframe: text(20),
    tradeStyle: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.enum(["Day Trade", "Scalp", "Swing"]).catch("Swing"),
    ).optional(),
    entry: price,
    stopLoss: price,
    takeProfit: price,
    risk_management: z.object({
      leverage: text(20),
      leverageReasoning: text(600),
      positionSize: text(60),
      sizeReasoning: text(600),
      riskRewardRatio: text(20),
      distanceToTarget: text(60),
    }).optional(),
    supportResistance: z.object({
      support: z.array(price).default([]).transform((a) => a.slice(0, 3)),
      resistance: z.array(price).default([]).transform((a) => a.slice(0, 3)),
    }).optional(),
    safeEntries: z.array(z.object({ price, reasoning: text(400) })).optional()
      .transform((a) => a?.slice(0, 3)),
    reasoning: text(3000),
    indicators_breakdown: z.array(z.object({
      name: text(40),
      value: text(60),
      signal: Bias,
      explanation: text(400),
    })).optional().transform((a) => a?.slice(0, 8)),
  })
  .superRefine((a, ctx) => {
    if (a.signal === "HOLD") return;
    if (!(a.entry > 0 && a.stopLoss > 0 && a.takeProfit > 0)) {
      ctx.addIssue({ code: "custom", message: "BUY/SELL requires positive entry, stopLoss and takeProfit" });
      return;
    }
    const ok = a.signal === "BUY"
      ? a.stopLoss < a.entry && a.entry < a.takeProfit
      : a.takeProfit < a.entry && a.entry < a.stopLoss;
    if (!ok) ctx.addIssue({ code: "custom", message: `${a.signal} levels are on the wrong side of entry` });
  });
export type Analysis = z.output<typeof AnalysisSchema>;

// ─── Screenshot → journal fields (/api/parse-screenshot) ─────────────────────

export const TradeScreenshotSchema = z.object({
  symbol: z.string().trim().max(30).nullable().default(null),
  position: z.preprocess(upper, z.enum(["LONG", "SHORT"]).nullable()).catch(null).default(null),
  entryPrice: nullableNumber.default(null),
  exitPrice: nullableNumber.default(null),
  leverage: nullableNumber.default(null),
  margin: nullableNumber.default(null),
  marginMode: z.preprocess(titleCase, z.enum(["Cross", "Isolated"]).nullable()).catch(null).default(null),
  pnlPercent: nullableNumber.default(null),
  pnlUsd: nullableNumber.default(null),
});
export type TradeScreenshot = z.output<typeof TradeScreenshotSchema>;

// ─── Post-mortem (/api/post-mortem) ──────────────────────────────────────────

export const PostMortemSchema = z.object({
  outcome: z.preprocess(upper, z.enum(["WIN", "LOSS", "BREAKEVEN", "OPEN"])),
  rootCause: text(800),
  mistakes: textList(6),
  strengths: textList(6),
  lesson: text(800),
  tags: textList(8, 40),
});
export type PostMortem = z.output<typeof PostMortemSchema>;

// ─── Chart academy (/api/chart-academy) ──────────────────────────────────────

const pct = z.preprocess(toNumberOrNull, z.number().min(0).max(100));

// Schema-constrained providers send every key, using null for "not applicable"; drop those nulls.
const dropNulls = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) : v;

const Annotation = z.preprocess(dropNulls, z.looseObject({
  type: z.enum(["hline", "line", "zone", "arrow_up", "arrow_down", "marker", "channel", "fib", "label"]),
  color: z.string().max(20).default("#94a3b8"),
  label: z.string().max(80).optional(),
}));

export const ChartAcademySchema = z.object({
  overallSignal: Signal,
  confluenceScore: confidence,
  summary: text(1200),
  lesson: text(1500),
  patterns: textList(10, 60),
  tags: textList(10, 30),
  mistakes: textList(6),
  strengths: textList(6),
  timeframes: z.array(z.looseObject({
    timeframe: text(10),
    signal: Signal,
    bias: text(400),
    reasoning: text(1500),
    keyLevels: z.array(z.looseObject({ type: z.string().max(20), price: z.coerce.string().max(40), y_pct: pct, description: text(300) })).default([]),
    entryPlan: z.looseObject({ entry_y: pct, sl_y: pct, tp1_y: pct, rrr: z.coerce.string().max(20) }).nullable().optional(),
    annotations: z.array(z.unknown()).default([])
      .transform((items) => items.flatMap((a) => { const p = Annotation.safeParse(a); return p.success ? [p.data] : []; }).slice(0, 25)),
  })).min(1).max(3),
});
export type ChartAcademy = z.output<typeof ChartAcademySchema>;
