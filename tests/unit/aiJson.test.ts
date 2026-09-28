import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseCompletionJson } from "@/lib/ai/json";
import { AnalysisSchema } from "@/lib/ai/schemas";

const schema = z.object({ signal: z.enum(["BUY", "SELL", "HOLD"]), confidence: z.coerce.number() });
const completion = (content: string | null, finish_reason = "stop", refusal?: string) => ({
  choices: [{ finish_reason, message: { content, refusal } }],
});

describe("parseCompletionJson", () => {
  it("parses plain JSON and coerces numeric strings", () => {
    expect(parseCompletionJson(completion('{"signal":"BUY","confidence":"72"}'), schema)).toEqual({ signal: "BUY", confidence: 72 });
  });
  it("strips markdown code fences", () => {
    expect(parseCompletionJson(completion('```json\n{"signal":"HOLD","confidence":50}\n```'), schema).signal).toBe("HOLD");
  });
  it("rejects truncated completions instead of parsing half a JSON object", () => {
    expect(() => parseCompletionJson(completion('{"signal":"BUY"', "length"), schema)).toThrow(expect.objectContaining({ code: "AI_TRUNCATED" }));
  });
  it("surfaces model refusals", () => {
    expect(() => parseCompletionJson(completion(null, "stop", "I can't help with that"), schema)).toThrow(expect.objectContaining({ code: "AI_REFUSED" }));
  });
  it("rejects malformed JSON", () => {
    expect(() => parseCompletionJson(completion("not json"), schema)).toThrow(expect.objectContaining({ code: "AI_BAD_JSON" }));
  });
  it("rejects output that does not match the schema", () => {
    expect(() => parseCompletionJson(completion('{"signal":"MAYBE","confidence":1}'), schema)).toThrow(expect.objectContaining({ code: "AI_SCHEMA" }));
  });
});

describe("AnalysisSchema", () => {
  const valid = {
    signal: "buy", confidence: "68", timeframe: "4H", tradeStyle: "Swing",
    entry: 100, stopLoss: "95", takeProfit: 110,
    risk_management: { leverage: "3x", leverageReasoning: "r", positionSize: "1%", sizeReasoning: "s", riskRewardRatio: "1:2", distanceToTarget: "10%" },
    supportResistance: { support: [95, "90"], resistance: [110] },
    safeEntries: [{ price: "99.5", reasoning: "OB retest" }],
    reasoning: "text",
    indicators_breakdown: [{ name: "RSI (14)", value: "55", signal: "neutral", explanation: "x" }],
  };
  it("normalizes casing and numeric strings", () => {
    const out = AnalysisSchema.parse(valid);
    expect(out.signal).toBe("BUY");
    expect(out.stopLoss).toBe(95);
    expect(out.supportResistance?.support).toEqual([95, 90]);
    expect(out.indicators_breakdown?.[0].signal).toBe("Neutral");
  });
  it("clamps confidence into 0–100", () => {
    expect(AnalysisSchema.parse({ ...valid, confidence: 140 }).confidence).toBe(100);
  });
  it("rejects a BUY whose stop is on the wrong side of entry", () => {
    expect(() => AnalysisSchema.parse({ ...valid, stopLoss: 105 })).toThrow();
  });
});
