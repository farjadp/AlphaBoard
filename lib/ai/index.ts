/**
 * Single entry point for every AI call: picks the model, enforces the user's daily token quota,
 * calls the provider, records usage/cost, and validates the answer.
 */
import type { z } from "zod";
import { logger } from "@/lib/http/logger";
import { estimateCostUsd, priceFor, resolveModel, type AiSettings } from "./catalog";
import { AiError } from "./errors";
import { parseModelJson } from "./json";
import { anthropicProvider } from "./providers/anthropic";
import { openAiCompatibleProvider } from "./providers/openaiCompatible";
import { hasImages, type CompletionRequest, type Provider, type ProviderId } from "./providers/types";
import type { UsageRow } from "./usage";

export type { ContentPart } from "./providers/types";

export interface AiDeps {
  providers: Record<ProviderId, Provider>;
  getSettings(): Promise<AiSettings>;
  getUser(userId: string): Promise<{ aiProvider: string | null; aiModel: string | null; dailyTokenQuota: number } | null>;
  tokensUsedToday(userId: string): Promise<number>;
  recordUsage(row: UsageRow): Promise<void>;
}

export interface AiRequest<S extends z.ZodType> extends CompletionRequest {
  feature: string;
  userId: string;
  schema: S;
}

export interface AiMeta {
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  visionFallback: boolean;
  /** Set when the requested model refused and a server-side fallback answered. */
  fallbackFrom?: string;
}

export function createAi(deps: AiDeps) {
  return async function aiJson<S extends z.ZodType>(req: AiRequest<S>): Promise<{ data: z.output<S>; meta: AiMeta }> {
    const [settings, user] = await Promise.all([deps.getSettings(), deps.getUser(req.userId)]);
    const configured = new Set((Object.values(deps.providers)).filter((p) => p.configured()).map((p) => p.id));
    const resolved = resolveModel({
      settings,
      configured,
      needsVision: hasImages(req.user),
      userPref: user ? { provider: user.aiProvider, model: user.aiModel } : null,
    });

    const quota = user?.dailyTokenQuota ?? settings.defaultDailyTokenQuota;
    const used = await deps.tokensUsedToday(req.userId);
    if (used >= quota) throw new AiError("AI_QUOTA", `${used}/${quota} tokens used today`);

    const started = Date.now();
    const base = { userId: req.userId, feature: req.feature, provider: resolved.provider, model: resolved.model };
    let result;
    try {
      result = await deps.providers[resolved.provider].complete(resolved.model, {
        system: req.system, user: req.user, maxTokens: req.maxTokens, temperature: req.temperature,
        jsonSchema: req.jsonSchema, timeoutMs: req.timeoutMs,
      });
    } catch (e) {
      const code = e instanceof AiError ? e.aiCode : "AI_UPSTREAM";
      await deps.recordUsage({ ...base, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: Date.now() - started, status: "error", errorCode: code });
      logger.warn({ ...base, code, detail: e instanceof AiError ? e.detail : String(e) }, "ai call failed");
      throw e instanceof AiError ? e : new AiError("AI_UPSTREAM", String(e));
    }

    const { inputTokens, outputTokens } = result.usage;
    const servedBy = result.model || resolved.model;
    // Top-level usage covers only the answering attempt, which bills at that model's rates.
    const costUsd = result.costUsd ?? estimateCostUsd(priceFor(resolved.provider, servedBy, resolved.info), inputTokens, outputTokens);
    const fallbackFrom = result.fellBack ? resolved.model : undefined;
    const meta: AiMeta = { provider: resolved.provider, model: servedBy, inputTokens, outputTokens, costUsd, visionFallback: !!resolved.visionFallback, ...(fallbackFrom ? { fallbackFrom } : {}) };
    const row = { ...base, model: meta.model, inputTokens, outputTokens, costUsd, latencyMs: Date.now() - started, fallbackFrom };

    try {
      const data = parseModelJson(result, req.schema);
      await deps.recordUsage({ ...row, status: "ok" });
      if (fallbackFrom) logger.warn({ ...row }, "ai refusal served by fallback model");
      else logger.info({ ...row }, "ai call ok");
      return { data, meta };
    } catch (e) {
      // The provider billed these tokens even though the answer was unusable.
      const code = e instanceof AiError ? e.aiCode : "AI_SCHEMA";
      await deps.recordUsage({ ...row, status: "error", errorCode: code });
      logger.warn({ ...row, code, detail: e instanceof AiError ? e.detail : String(e) }, "ai answer rejected");
      throw e;
    }
  };
}

let defaultAi: ReturnType<typeof createAi> | null = null;

/** The app-wide instance (lazy so tests can import this module without a database). */
export async function aiJson<S extends z.ZodType>(req: AiRequest<S>) {
  if (!defaultAi) {
    const [{ prisma }, usage, settings] = await Promise.all([import("@/lib/prisma"), import("./usage"), import("./settings")]);
    defaultAi = createAi({
      providers: {
        openai: openAiCompatibleProvider("openai"),
        openrouter: openAiCompatibleProvider("openrouter"),
        deepseek: openAiCompatibleProvider("deepseek"),
        anthropic: anthropicProvider,
      },
      getSettings: settings.getAiSettings,
      getUser: (id) => prisma.user.findUnique({ where: { id }, select: { aiProvider: true, aiModel: true, dailyTokenQuota: true } }),
      tokensUsedToday: (id) => usage.tokensUsedToday(id),
      recordUsage: usage.recordUsage,
    });
  }
  return defaultAi(req);
}
