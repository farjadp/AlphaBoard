import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/http/errors";
import { DEFAULT_AI_SETTINGS, findModel, type AiSettings } from "./catalog";

const KEY = "ai.defaults";
const provider = z.enum(["openai", "anthropic", "openrouter", "deepseek"]);

export const AiSettingsInput = z.object({
  provider,
  model: z.string().max(80),
  visionProvider: provider,
  visionModel: z.string().max(80),
  defaultDailyTokenQuota: z.number().int().min(1).max(50_000_000),
});

let cache: { value: AiSettings; at: number } | null = null;

function envDefaults(): AiSettings {
  const p = process.env.AI_DEFAULT_PROVIDER;
  const m = process.env.AI_DEFAULT_MODEL;
  return p && m && findModel(p, m) ? { ...DEFAULT_AI_SETTINGS, provider: p as AiSettings["provider"], model: m } : DEFAULT_AI_SETTINGS;
}

/** Admin-set defaults (AppSetting), falling back to env, then the built-in defaults. Cached 30s. */
export async function getAiSettings(): Promise<AiSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const parsed = AiSettingsInput.safeParse(row?.value);
  const value = parsed.success ? parsed.data : envDefaults();
  cache = { value, at: Date.now() };
  return value;
}

export async function setAiSettings(input: z.input<typeof AiSettingsInput>): Promise<AiSettings> {
  const s = AiSettingsInput.parse(input);
  if (!findModel(s.provider, s.model)) throw badRequest("Unknown default model", "BAD_MODEL");
  const vision = findModel(s.visionProvider, s.visionModel);
  if (!vision) throw badRequest("Unknown vision model", "BAD_MODEL");
  if (!vision.vision) throw badRequest("The vision model must accept images", "BAD_MODEL");
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: s as unknown as Prisma.InputJsonValue },
    update: { value: s as unknown as Prisma.InputJsonValue },
  });
  cache = { value: s, at: Date.now() };
  return s;
}
