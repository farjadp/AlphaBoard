/**
 * Output contracts for the session agents (spec E13/E14). Zod is the final validator for every
 * provider; the closed JSON Schemas drive schema-constrained output where the provider supports it.
 * Consistency is tested in agentSchemas.test.ts.
 */
import { z } from "zod";

const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase().replace(/[\s-]+/g, "_") : v);
const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);
const clip = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const num01 = z.coerce.number().transform((n) => Math.min(1, Math.max(0, n > 1 ? n / 100 : n)));
const nullableNum = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().positive().nullable());

export const AnalystNotesSchema = z.object({
  notes: z.array(z.object({
    symbol: z.string().trim().max(30),
    stance: z.preprocess(lower, z.enum(["bullish", "bearish", "neutral"])),
    confidence: num01,
    summary: clip(600),
    keyPoints: z.array(clip(200)).max(8).transform((a) => a.slice(0, 5)),
  })).max(10),
});
export type AnalystNotes = z.output<typeof AnalystNotesSchema>;

export const DebateSchema = z.object({ bull: clip(1200), bear: clip(1200) });
export type Debate = z.output<typeof DebateSchema>;

export const StrategistDecisionSchema = z.object({
  action: z.preprocess(upper, z.enum(["OPEN_LONG", "OPEN_SHORT", "CLOSE", "TIGHTEN_STOP", "HOLD"])),
  symbol: z.string().trim().max(30),
  positionId: z.string().trim().max(64).nullable(),
  conviction: num01,
  thesis: clip(800),
  stopLoss: nullableNum,
  takeProfit: nullableNum,
  invalidation: clip(300),
  horizonMin: z.coerce.number().int().min(0).max(10_080),
});
export const StrategistPlanSchema = z.object({
  decisions: z.array(StrategistDecisionSchema).max(10),
  commentary: clip(1200),
});
export type StrategistPlan = z.output<typeof StrategistPlanSchema>;
export type StrategistDecision = z.output<typeof StrategistDecisionSchema>;

export const TradeLessonSchema = z.object({
  outcome: z.preprocess(upper, z.enum(["WIN", "LOSS", "BREAKEVEN"])),
  rootCause: clip(1200),
  mistakes: z.array(clip(300)).max(8).transform((a) => a.slice(0, 5)),
  strengths: z.array(clip(300)).max(8).transform((a) => a.slice(0, 5)),
  lesson: clip(800),
  tags: z.array(clip(40)).max(10),
});
export type TradeLessonOut = z.output<typeof TradeLessonSchema>;

export const SessionSummarySchema = z.object({
  summary: clip(2400),
  lessons: z.array(clip(400)).max(8).transform((a) => a.slice(0, 5)),
});
export type SessionSummary = z.output<typeof SessionSummarySchema>;

// ─── Closed JSON Schemas ──────────────────────────────────────────────────────

type Schema = Record<string, unknown>;
const str = { type: "string" } as const;
const num = { type: "number" } as const;
const strList = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>): Schema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const AGENT_JSON_SCHEMAS = {
  analystNotes: obj({
    notes: { type: "array", items: obj({ symbol: str, stance: { type: "string", enum: ["bullish", "bearish", "neutral"] }, confidence: num, summary: str, keyPoints: strList }) },
  }),
  debate: obj({ bull: str, bear: str }),
  strategistPlan: obj({
    decisions: {
      type: "array",
      items: obj({
        action: { type: "string", enum: ["OPEN_LONG", "OPEN_SHORT", "CLOSE", "TIGHTEN_STOP", "HOLD"] },
        symbol: str, positionId: { type: ["string", "null"] }, conviction: num, thesis: str,
        stopLoss: { type: ["number", "null"] }, takeProfit: { type: ["number", "null"] }, invalidation: str, horizonMin: num,
      }),
    },
    commentary: str,
  }),
  tradeLesson: obj({ outcome: { type: "string", enum: ["WIN", "LOSS", "BREAKEVEN"] }, rootCause: str, mistakes: strList, strengths: strList, lesson: str, tags: strList }),
  sessionSummary: obj({ summary: str, lessons: strList }),
} as const;
