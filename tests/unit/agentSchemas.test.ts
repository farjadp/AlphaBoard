import { describe, it, expect } from "vitest";
import {
  AGENT_JSON_SCHEMAS, AnalystNotesSchema, DebateSchema, SessionSummarySchema, StrategistPlanSchema, TradeLessonSchema,
} from "@/lib/agents/schemas";

type Node = { type?: string | string[]; properties?: Record<string, Node>; items?: Node; required?: string[]; additionalProperties?: unknown };

function walk(node: Node, path: string, visit: (n: Node, p: string) => void) {
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("object")) visit(node, path);
  for (const [k, v] of Object.entries(node.properties ?? {})) walk(v, `${path}.${k}`, visit);
  if (node.items) walk(node.items, `${path}[]`, visit);
}

const samples = {
  analystNotes: [AnalystNotesSchema, { notes: [{ symbol: "BTC/USDT", stance: "bullish", confidence: 0.6, summary: "s", keyPoints: ["a"] }] }],
  debate: [DebateSchema, { bull: "b", bear: "c" }],
  strategistPlan: [StrategistPlanSchema, {
    decisions: [{ action: "OPEN_LONG", symbol: "BTC/USDT", positionId: null, conviction: 0.7, thesis: "t", stopLoss: 95, takeProfit: 110, invalidation: "i", horizonMin: 240 }],
    commentary: "c",
  }],
  tradeLesson: [TradeLessonSchema, { outcome: "WIN", rootCause: "r", mistakes: [], strengths: ["s"], lesson: "l", tags: ["t"] }],
  sessionSummary: [SessionSummarySchema, { summary: "s", lessons: ["l"] }],
} as const;

describe("agent output schemas", () => {
  for (const [name, schema] of Object.entries(AGENT_JSON_SCHEMAS)) {
    it(`${name}: closed JSON schema and a sample that zod accepts with exactly those keys`, () => {
      walk(schema as Node, name, (n, p) => {
        expect(n.additionalProperties, p).toBe(false);
        expect(n.required, p).toEqual(Object.keys(n.properties ?? {}));
      });
      const [zod, sample] = samples[name as keyof typeof samples];
      expect(() => (zod as { parse(v: unknown): unknown }).parse(sample)).not.toThrow();
      expect(Object.keys(sample).sort()).toEqual([...((schema as Node).required ?? [])].sort());
    });
  }

  it("normalizes loose model output", () => {
    const plan = StrategistPlanSchema.parse({
      decisions: [{ action: "open long", symbol: "BTC/USDT", positionId: null, conviction: 70, thesis: "t", stopLoss: "95", takeProfit: "", invalidation: "i", horizonMin: "240" }],
      commentary: "c",
    });
    expect(plan.decisions[0]).toMatchObject({ action: "OPEN_LONG", conviction: 0.7, stopLoss: 95, takeProfit: null, horizonMin: 240 });
    expect(AnalystNotesSchema.parse({ notes: [{ symbol: "X", stance: "Bearish", confidence: 140, summary: "s", keyPoints: [] }] }).notes[0]).toMatchObject({ stance: "bearish", confidence: 1 });
  });

  it("rejects unknown actions and non-positive prices", () => {
    const base = { symbol: "BTC/USDT", positionId: null, conviction: 0.5, thesis: "t", takeProfit: null, invalidation: "i", horizonMin: 60 };
    expect(() => StrategistPlanSchema.parse({ decisions: [{ ...base, action: "YOLO", stopLoss: 1 }], commentary: "" })).toThrow();
    expect(() => StrategistPlanSchema.parse({ decisions: [{ ...base, action: "HOLD", stopLoss: -5 }], commentary: "" })).toThrow();
  });
});
