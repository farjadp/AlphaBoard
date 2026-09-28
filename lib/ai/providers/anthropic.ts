/**
 * Claude via the official Anthropic TypeScript SDK.
 * - Structured outputs (output_config.format json_schema) so the answer always matches the schema.
 * - No sampling params on the 5-series (they return 400); adaptive thinking is on by default there,
 *   and thinking tokens count against max_tokens, so the cap has headroom.
 * - Claude Opus 5 opts into server-side refusal fallbacks (routed by refusal category).
 */
import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "../errors";
import type { CompletionRequest, CompletionResult, FinishReason, Provider } from "./types";

const MIN_MAX_TOKENS = 16_000;
const SAMPLING_ALLOWED = new Set(["claude-haiku-4-5"]);
const FALLBACK_MODELS = new Set(["claude-opus-5"]);

type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function toBlocks(user: CompletionRequest["user"]) {
  if (typeof user === "string") return user;
  return user.map((p) => {
    if (p.type === "text") return { type: "text" as const, text: p.text };
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(p.image_url.url);
    return m
      ? { type: "image" as const, source: { type: "base64" as const, media_type: m[1] as ImageMime, data: m[2] } }
      : { type: "image" as const, source: { type: "url" as const, url: p.image_url.url } };
  });
}

export function buildAnthropicParams(model: string, req: CompletionRequest) {
  return {
    model,
    max_tokens: Math.max(req.maxTokens, MIN_MAX_TOKENS),
    system: req.system,
    messages: [{ role: "user" as const, content: toBlocks(req.user) }],
    ...(req.jsonSchema ? { output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema } } } : {}),
    ...(SAMPLING_ALLOWED.has(model) && req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
}

type RawMessage = {
  model: string;
  stop_reason: string | null;
  content: Array<{ type: string; text?: string; thinking?: string }>;
  usage: {
    input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
    /** Per-attempt breakdown; a `fallback_message` entry means a fallback model produced the answer. */
    iterations?: Array<{ type: string }> | null;
  };
  stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null;
};

const STOP: Record<string, FinishReason> = { end_turn: "stop", stop_sequence: "stop", max_tokens: "length", refusal: "refusal" };

export function normalizeAnthropicMessage(msg: RawMessage): CompletionResult {
  const finishReason = STOP[msg.stop_reason ?? ""] ?? "other";
  return {
    text: msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    finishReason,
    refusal: finishReason === "refusal" ? msg.stop_details?.category ?? "refusal" : undefined,
    usage: {
      inputTokens: msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0),
      outputTokens: msg.usage.output_tokens,
    },
    model: msg.model,
    fellBack: (msg.usage.iterations ?? []).some((i) => i.type === "fallback_message"),
  };
}

export const anthropicProvider: Provider = {
  id: "anthropic",
  configured: () => !!process.env.ANTHROPIC_API_KEY,
  async complete(model, req) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AiError("AI_NOT_CONFIGURED", "anthropic key missing");
    // Explicit key only: a server must not silently pick up a developer's local CLI login.
    const client = new Anthropic({ apiKey, timeout: req.timeoutMs ?? 120_000, maxRetries: 1 });
    try {
      const msg = await client.beta.messages.create(buildAnthropicParams(model, req) as Parameters<typeof client.beta.messages.create>[0]);
      return normalizeAnthropicMessage(msg as unknown as RawMessage);
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError("AI_TIMEOUT", e.message);
      if (e instanceof Anthropic.RateLimitError) throw new AiError("AI_RATE_LIMITED", e.message);
      if (e instanceof Anthropic.APIError) throw new AiError("AI_UPSTREAM", `anthropic ${e.status}: ${e.message}`);
      throw e;
    }
  },
};
