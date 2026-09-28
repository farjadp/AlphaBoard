/**
 * OpenAI chat-completions client with strict JSON handling. P3 generalizes this behind a
 * provider interface (Anthropic, OpenRouter, DeepSeek); the call shape stays the same.
 */
import type { z } from "zod";
import { logger } from "@/lib/http/logger";
import { AiError } from "./errors";
import { parseCompletionJson } from "./json";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface ChatJsonRequest<S extends z.ZodType> {
  feature: string;                 // for logs/usage: "analyze", "post-mortem", …
  userId?: string;
  system: string;
  user: string | ContentPart[];
  schema: S;
  model?: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}

export async function openaiChatJson<S extends z.ZodType>(req: ChatJsonRequest<S>): Promise<z.output<S>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiError("AI_NOT_CONFIGURED");
  const model = req.model ?? process.env.OPENAI_MODEL ?? "gpt-4o";
  const started = Date.now();

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
        response_format: { type: "json_object" },
        temperature: req.temperature ?? 0,
        max_tokens: req.maxTokens,
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 90_000),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    logger.error({ feature: req.feature, model, err: e instanceof Error ? e.message : String(e) }, "openai request failed");
    throw new AiError(timedOut ? "AI_TIMEOUT" : "AI_UPSTREAM");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error({ feature: req.feature, model, status: res.status, body: body.slice(0, 500) }, "openai error response");
    throw new AiError("AI_UPSTREAM", `status ${res.status}`);
  }

  const completion = await res.json();
  const usage = completion?.usage ?? {};
  const log = { feature: req.feature, userId: req.userId, model, ms: Date.now() - started, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
  try {
    const data = parseCompletionJson(completion, req.schema);
    logger.info(log, "ai call ok");
    return data;
  } catch (e) {
    logger.warn({ ...log, code: e instanceof AiError ? e.aiCode : "UNKNOWN", detail: e instanceof AiError ? e.detail : String(e) }, "ai call rejected");
    throw e;
  }
}
