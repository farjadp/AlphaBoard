import { describe, it, expect } from "vitest";
import { JSON_SCHEMAS } from "@/lib/ai/jsonSchemas";
import { AnalysisSchema, ChartAcademySchema, PostMortemSchema, TradeScreenshotSchema } from "@/lib/ai/schemas";

type Node = { type?: string | string[]; properties?: Record<string, Node>; items?: Node; required?: string[]; additionalProperties?: unknown; anyOf?: Node[] };

function walkObjects(node: Node, path: string, visit: (n: Node, p: string) => void) {
  if (!node || typeof node !== "object") return;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("object")) visit(node, path);
  for (const [k, v] of Object.entries(node.properties ?? {})) walkObjects(v, `${path}.${k}`, visit);
  if (node.items) walkObjects(node.items, `${path}[]`, visit);
  for (const [i, v] of (node.anyOf ?? []).entries()) walkObjects(v, `${path}|${i}`, visit);
}

describe("structured-output JSON schemas", () => {
  for (const [name, schema] of Object.entries(JSON_SCHEMAS)) {
    it(`${name}: every object is closed and lists its required keys`, () => {
      walkObjects(schema as Node, name, (n, p) => {
        expect(n.additionalProperties, p).toBe(false);
        expect(Array.isArray(n.required), p).toBe(true);
      });
    });
  }

  const samples = {
    analysis: [AnalysisSchema, {
      signal: "HOLD", confidence: 50, timeframe: "4H", tradeStyle: "Swing", entry: 100, stopLoss: 95, takeProfit: 110,
      risk_management: { leverage: "2x", leverageReasoning: "r", positionSize: "1%", sizeReasoning: "s", riskRewardRatio: "1:2", distanceToTarget: "10%" },
      supportResistance: { support: [95], resistance: [110] }, safeEntries: [{ price: 99, reasoning: "r" }], reasoning: "r",
      indicators_breakdown: [{ name: "RSI", value: "50", signal: "Neutral", explanation: "e" }],
    }],
    tradeScreenshot: [TradeScreenshotSchema, { symbol: "BTC/USDT", position: "LONG", entryPrice: 1, exitPrice: null, leverage: 5, margin: 10, marginMode: "Cross", pnlPercent: 1.2, pnlUsd: 0.1 }],
    postMortem: [PostMortemSchema, { outcome: "WIN", rootCause: "r", mistakes: [], strengths: ["s"], lesson: "l", tags: ["t"] }],
    chartAcademy: [ChartAcademySchema, {
      overallSignal: "BUY", confluenceScore: 70, summary: "s", lesson: "l", patterns: ["OB"], tags: ["smc"], mistakes: [], strengths: [],
      timeframes: [{ timeframe: "4H", signal: "BUY", bias: "b", reasoning: "r", keyLevels: [{ type: "Support", price: "~100", y_pct: 60, description: "d" }],
        entryPlan: { entry_y: 60, sl_y: 70, tp1_y: 40, tp2_y: null, rrr: "1:2" }, candlestickPattern: null, chartPattern: null,
        annotations: [{ type: "hline", category: "support", color: "#34d399", label: "S", priority: "high", note: null, y: 60, x1: null, y1: null, x2: null, y2: null, zx: null, zy: null, zw: null, zh: null, mx: null, my: null, dashed: false, thickness: 1, fillOpacity: null }] }],
    }],
  } as const;

  for (const [name, [zodSchema, sample]] of Object.entries(samples)) {
    it(`${name}: a schema-shaped answer passes the zod validator`, () => {
      expect(JSON_SCHEMAS).toHaveProperty(name);
      expect(zodSchema.safeParse(sample).success).toBe(true);
    });
  }
});
