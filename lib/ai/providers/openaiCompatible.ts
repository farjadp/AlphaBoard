/** OpenAI, OpenRouter and DeepSeek share the Chat Completions wire format. */
import { AiError } from "../errors";
import { findModel } from "../catalog";
import type { CompletionRequest, CompletionResult, FinishReason, Provider, ProviderId } from "./types";

const BASE_URL: Record<Exclude<ProviderId, "anthropic">, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com",
};
const KEY_ENV: Record<Exclude<ProviderId, "anthropic">, string> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

/** Reasoning models spend completion tokens on hidden reasoning; give them room so answers are not cut. */
const REASONING_MIN_TOKENS = 16_000;

export interface OpenAiBody {
  model: string;
  messages: Array<{ role: "system" | "user"; content: CompletionRequest["user"] }>;
  response_format: { type: "json_object" };
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  usage?: { include: boolean };
}

export function buildOpenAiBody(provider: Exclude<ProviderId, "anthropic">, model: string, req: CompletionRequest): OpenAiBody {
  const reasoning = findModel(provider, model)?.reasoning ?? false;
  const cap = reasoning ? Math.max(req.maxTokens, REASONING_MIN_TOKENS) : req.maxTokens;
  return {
    model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: { type: "json_object" },
    // OpenAI deprecated max_tokens for max_completion_tokens (required by reasoning models).
    ...(provider === "openai" ? { max_completion_tokens: cap } : { max_tokens: cap }),
    ...(reasoning ? {} : { temperature: req.temperature ?? 0 }),
    ...(provider === "openrouter" ? { usage: { include: true } } : {}),
  };
}

type RawCompletion = {
  model?: string;
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

const FINISH: Record<string, FinishReason> = { stop: "stop", length: "length", content_filter: "refusal" };

export function normalizeOpenAiResponse(raw: RawCompletion, requestedModel = ""): CompletionResult {
  const choice = raw.choices?.[0];
  const refusal = choice?.message?.refusal ?? undefined;
  return {
    text: choice?.message?.content ?? "",
    finishReason: refusal ? "refusal" : FINISH[choice?.finish_reason ?? ""] ?? "other",
    refusal,
    usage: { inputTokens: raw.usage?.prompt_tokens ?? 0, outputTokens: raw.usage?.completion_tokens ?? 0 },
    model: raw.model ?? requestedModel,
    costUsd: typeof raw.usage?.cost === "number" ? raw.usage.cost : undefined,
  };
}

export function openAiCompatibleProvider(id: Exclude<ProviderId, "anthropic">): Provider {
  return {
    id,
    configured: () => !!process.env[KEY_ENV[id]],
    async complete(model, req) {
      const key = process.env[KEY_ENV[id]];
      if (!key) throw new AiError("AI_NOT_CONFIGURED", `${id} key missing`);
      let res: Response;
      try {
        res = await fetch(`${BASE_URL[id]}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            ...(id === "openrouter" ? { "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000", "X-Title": "AlphaBoard" } : {}),
          },
          body: JSON.stringify(buildOpenAiBody(id, model, req)),
          signal: AbortSignal.timeout(req.timeoutMs ?? 90_000),
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new AiError(timedOut ? "AI_TIMEOUT" : "AI_UPSTREAM", e instanceof Error ? e.message : String(e));
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new AiError(res.status === 429 ? "AI_RATE_LIMITED" : "AI_UPSTREAM", `${id} ${res.status}: ${body.slice(0, 300)}`);
      }
      return normalizeOpenAiResponse(await res.json(), model);
    },
  };
}
