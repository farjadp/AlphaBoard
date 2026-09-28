/**
 * Models AlphaBoard can use, with per-million-token list prices.
 * Prices verified 2026-09-28: OpenAI and Anthropic via OpenRouter's public model list (which mirrors
 * list prices) and Anthropic's model table; DeepSeek from api-docs.deepseek.com (peak rate — the
 * conservative one). OpenRouter calls record the provider-reported cost instead of these estimates.
 */
import { AiError } from "./errors";
import type { ProviderId } from "./providers/types";

export interface ModelInfo {
  provider: ProviderId;
  id: string;
  label: string;
  vision: boolean;
  /** Reasoning/thinking models: no temperature, extra token headroom. */
  reasoning: boolean;
  priceInPerM: number;
  priceOutPerM: number;
}

export const PROVIDERS: Record<ProviderId, { label: string; envKey: string }> = {
  openai: { label: "OpenAI", envKey: "OPENAI_API_KEY" },
  anthropic: { label: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY" },
  openrouter: { label: "OpenRouter", envKey: "OPENROUTER_API_KEY" },
  deepseek: { label: "DeepSeek", envKey: "DEEPSEEK_API_KEY" },
};

export const MODELS: ModelInfo[] = [
  { provider: "openai", id: "gpt-4o", label: "GPT-4o", vision: true, reasoning: false, priceInPerM: 2.5, priceOutPerM: 10 },
  { provider: "openai", id: "gpt-4o-mini", label: "GPT-4o mini", vision: true, reasoning: false, priceInPerM: 0.15, priceOutPerM: 0.6 },
  { provider: "openai", id: "gpt-4.1", label: "GPT-4.1", vision: true, reasoning: false, priceInPerM: 2, priceOutPerM: 8 },
  { provider: "openai", id: "gpt-5.4", label: "GPT-5.4", vision: true, reasoning: true, priceInPerM: 2.5, priceOutPerM: 15 },
  { provider: "openai", id: "gpt-5.4-mini", label: "GPT-5.4 mini", vision: true, reasoning: true, priceInPerM: 0.75, priceOutPerM: 4.5 },
  { provider: "openai", id: "gpt-5.5", label: "GPT-5.5", vision: true, reasoning: true, priceInPerM: 5, priceOutPerM: 30 },

  { provider: "anthropic", id: "claude-opus-5", label: "Claude Opus 5", vision: true, reasoning: true, priceInPerM: 5, priceOutPerM: 25 },
  { provider: "anthropic", id: "claude-sonnet-5", label: "Claude Sonnet 5", vision: true, reasoning: true, priceInPerM: 2, priceOutPerM: 10 },
  { provider: "anthropic", id: "claude-haiku-4-5", label: "Claude Haiku 4.5", vision: true, reasoning: false, priceInPerM: 1, priceOutPerM: 5 },

  { provider: "openrouter", id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 (via OpenRouter)", vision: true, reasoning: true, priceInPerM: 2, priceOutPerM: 10 },
  { provider: "openrouter", id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini (via OpenRouter)", vision: true, reasoning: true, priceInPerM: 0.75, priceOutPerM: 4.5 },
  { provider: "openrouter", id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash (via OpenRouter)", vision: true, reasoning: true, priceInPerM: 1.5, priceOutPerM: 9 },
  { provider: "openrouter", id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro (via OpenRouter)", vision: false, reasoning: false, priceInPerM: 0.78, priceOutPerM: 1.57 },

  { provider: "deepseek", id: "deepseek-flash", label: "DeepSeek Flash", vision: true, reasoning: false, priceInPerM: 0.3, priceOutPerM: 1.2 },
  { provider: "deepseek", id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", vision: false, reasoning: false, priceInPerM: 1.32, priceOutPerM: 3.96 },
];

export function findModel(provider: string | null | undefined, id: string | null | undefined): ModelInfo | undefined {
  return MODELS.find((m) => m.provider === provider && m.id === id);
}

export function estimateCostUsd(m: Pick<ModelInfo, "priceInPerM" | "priceOutPerM">, inputTokens: number, outputTokens: number): number {
  return (inputTokens * m.priceInPerM + outputTokens * m.priceOutPerM) / 1_000_000;
}

export interface AiSettings {
  provider: ProviderId;
  model: string;
  visionProvider: ProviderId;
  visionModel: string;
  defaultDailyTokenQuota: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "openai",
  model: "gpt-4o",
  visionProvider: "openai",
  visionModel: "gpt-4o",
  defaultDailyTokenQuota: 200_000,
};

export interface ResolvedModel { provider: ProviderId; model: string; info: ModelInfo; visionFallback?: boolean }

/**
 * Pick the model for a call: the user's choice if usable, else the admin default, else any configured
 * model. Calls that include images are moved to a vision-capable model.
 */
export function resolveModel(opts: {
  settings: AiSettings;
  configured: ReadonlySet<ProviderId>;
  needsVision: boolean;
  userPref?: { provider?: string | null; model?: string | null } | null;
}): ResolvedModel {
  const usable = (provider?: string | null, id?: string | null) => {
    const m = findModel(provider, id);
    return m && opts.configured.has(m.provider) ? m : undefined;
  };
  const chosen =
    usable(opts.userPref?.provider, opts.userPref?.model) ??
    usable(opts.settings.provider, opts.settings.model) ??
    MODELS.find((m) => opts.configured.has(m.provider));
  if (!chosen) throw new AiError("AI_NOT_CONFIGURED", "no provider API key configured");
  if (!opts.needsVision || chosen.vision) return { provider: chosen.provider, model: chosen.id, info: chosen };

  const vision =
    [usable(opts.settings.visionProvider, opts.settings.visionModel)].find((m) => m?.vision) ??
    MODELS.find((m) => m.vision && opts.configured.has(m.provider));
  if (!vision) throw new AiError("AI_NOT_CONFIGURED", "no image-capable model configured");
  return { provider: vision.provider, model: vision.id, info: vision, visionFallback: true };
}
