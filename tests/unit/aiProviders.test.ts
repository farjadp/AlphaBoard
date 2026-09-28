import { describe, it, expect } from "vitest";
import { buildOpenAiBody, normalizeOpenAiResponse } from "@/lib/ai/providers/openaiCompatible";
import { buildAnthropicParams, normalizeAnthropicMessage } from "@/lib/ai/providers/anthropic";

const png = "data:image/png;base64,iVBORw0KGgo=";
const req = {
  system: "sys",
  user: [{ type: "text" as const, text: "read this" }, { type: "image_url" as const, image_url: { url: png, detail: "high" as const } }],
  maxTokens: 900,
  temperature: 0.3,
  jsonSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
};

describe("OpenAI-compatible adapter", () => {
  it("classic models: JSON mode, requested token cap, temperature kept", () => {
    const body = buildOpenAiBody("openai", "gpt-4o", req);
    expect(body).toMatchObject({ model: "gpt-4o", response_format: { type: "json_object" }, max_completion_tokens: 900, temperature: 0.3 });
    expect(body).not.toHaveProperty("max_tokens");
  });
  it("reasoning models: no temperature, room for reasoning tokens", () => {
    const body = buildOpenAiBody("openai", "gpt-5.4-mini", req);
    expect(body).not.toHaveProperty("temperature");
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(16_000);
  });
  it("OpenRouter asks for the real billed cost", () => {
    expect(buildOpenAiBody("openrouter", "anthropic/claude-sonnet-5", req)).toMatchObject({ usage: { include: true } });
  });
  it("normalizes finish reasons, refusals, usage and OpenRouter cost", () => {
    const out = normalizeOpenAiResponse({
      model: "gpt-4o-2024-08-06",
      choices: [{ finish_reason: "length", message: { content: '{"a":' } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, cost: 0.0012 },
    });
    expect(out).toMatchObject({ text: '{"a":', finishReason: "length", usage: { inputTokens: 120, outputTokens: 40 }, costUsd: 0.0012, model: "gpt-4o-2024-08-06" });
    expect(normalizeOpenAiResponse({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] }).finishReason).toBe("refusal");
  });
});

describe("Anthropic adapter", () => {
  it("uses structured outputs with the feature's JSON schema, and base64 image blocks", () => {
    const p = buildAnthropicParams("claude-sonnet-5", req);
    expect(p.output_config).toEqual({ format: { type: "json_schema", schema: req.jsonSchema } });
    expect(p.system).toBe("sys");
    const content = p.messages[0].content as Array<{ type: string; source?: { type: string; media_type: string; data: string } }>;
    expect(content.map((b) => b.type)).toEqual(["text", "image"]);
    expect(content[1].source).toEqual({ type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" });
  });
  it("never sends sampling params to the 5-series (they return 400) and leaves room for adaptive thinking", () => {
    const p = buildAnthropicParams("claude-opus-5", req);
    expect(p).not.toHaveProperty("temperature");
    expect(p.max_tokens).toBeGreaterThanOrEqual(16_000);
  });
  it("opts Opus 5 into server-side refusal fallbacks", () => {
    expect(buildAnthropicParams("claude-opus-5", req)).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(buildAnthropicParams("claude-haiku-4-5", req)).not.toHaveProperty("fallbacks");
  });
  it("maps stop reasons and usage; reports the model that actually served the request", () => {
    const ok = normalizeAnthropicMessage({
      model: "claude-opus-5", stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"a":"b"}' }],
      usage: { input_tokens: 500, output_tokens: 80 },
    });
    expect(ok).toMatchObject({ text: '{"a":"b"}', finishReason: "stop", usage: { inputTokens: 500, outputTokens: 80 }, model: "claude-opus-5" });
    expect(normalizeAnthropicMessage({ model: "m", stop_reason: "max_tokens", content: [], usage: { input_tokens: 1, output_tokens: 1 } }).finishReason).toBe("length");
    expect(normalizeAnthropicMessage({ model: "m", stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 }, stop_details: { type: "refusal", category: "cyber", explanation: "x" } }))
      .toMatchObject({ finishReason: "refusal", refusal: "cyber" });
  });
  it("flags answers served by a server-side fallback model", () => {
    const rescued = normalizeAnthropicMessage({
      model: "claude-opus-4-8", stop_reason: "end_turn",
      content: [{ type: "fallback" }, { type: "text", text: "{}" }],
      usage: { input_tokens: 40, output_tokens: 9, iterations: [{ type: "message" }, { type: "fallback_message" }] },
    });
    expect(rescued).toMatchObject({ model: "claude-opus-4-8", fellBack: true });
    expect(normalizeAnthropicMessage({ model: "claude-opus-5", stop_reason: "end_turn", content: [], usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: "message" }] } }).fellBack).toBeFalsy();
  });
});
