export type ProviderId = "openai" | "anthropic" | "openrouter" | "deepseek";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface CompletionRequest {
  system: string;
  user: string | ContentPart[];
  /** Tokens for the answer itself. Providers that think/reason add headroom on top. */
  maxTokens: number;
  temperature?: number;
  /** Closed JSON Schema for providers with schema-constrained output (Anthropic). */
  jsonSchema?: Record<string, unknown>;
  timeoutMs?: number;
}

export type FinishReason = "stop" | "length" | "refusal" | "other";

export interface CompletionResult {
  text: string;
  finishReason: FinishReason;
  refusal?: string;
  usage: { inputTokens: number; outputTokens: number };
  /** The model that actually served the request (may differ after a fallback). */
  model: string;
  /** True when the requested model declined and a server-side fallback model answered instead. */
  fellBack?: boolean;
  /** Provider-reported cost when available (OpenRouter); otherwise estimated from the catalog. */
  costUsd?: number;
}

export interface Provider {
  id: ProviderId;
  configured(): boolean;
  complete(model: string, req: CompletionRequest): Promise<CompletionResult>;
}

export const hasImages = (user: CompletionRequest["user"]) =>
  Array.isArray(user) && user.some((p) => p.type === "image_url");
