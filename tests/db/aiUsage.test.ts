/** AI orchestration against Postgres with fake providers: quota, usage accounting, model routing. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createAi } from "@/lib/ai";
import { recordUsage, tokensUsedToday, startOfUtcDay } from "@/lib/ai/usage";
import { getAiSettings, setAiSettings } from "@/lib/ai/settings";
import { AiError } from "@/lib/ai/errors";
import type { CompletionResult, Provider, ProviderId } from "@/lib/ai/providers/types";

const run = !!process.env.TEST_DATABASE_URL;
const schema = z.object({ ok: z.boolean() });

function fakeProvider(id: ProviderId, result: Partial<CompletionResult> | Error, calls: string[]): Provider {
  return {
    id,
    configured: () => true,
    async complete(model) {
      calls.push(`${id}:${model}`);
      if (result instanceof Error) throw result;
      return { text: '{"ok":true}', finishReason: "stop", usage: { inputTokens: 300, outputTokens: 100 }, model, ...result };
    },
  };
}

describe.skipIf(!run)("AI orchestration (Postgres)", () => {
  let userId: string;
  const calls: string[] = [];
  const deps = (providers: Partial<Record<ProviderId, Provider>>) => ({
    providers: {
      openai: { id: "openai" as const, configured: () => false, complete: async () => { throw new Error("unused"); } },
      anthropic: { id: "anthropic" as const, configured: () => false, complete: async () => { throw new Error("unused"); } },
      openrouter: { id: "openrouter" as const, configured: () => false, complete: async () => { throw new Error("unused"); } },
      deepseek: { id: "deepseek" as const, configured: () => false, complete: async () => { throw new Error("unused"); } },
      ...providers,
    },
    getSettings: getAiSettings,
    getUser: (id: string) => prisma.user.findUnique({ where: { id }, select: { aiProvider: true, aiModel: true, dailyTokenQuota: true } }),
    tokensUsedToday,
    recordUsage,
  });

  beforeAll(async () => {
    await prisma.appSetting.deleteMany({ where: { key: "ai.defaults" } });
    userId = (await prisma.user.create({ data: { email: `ai-${Date.now()}@test.local`, passwordHash: "x", dailyTokenQuota: 1_000 } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("records tokens and cost, and blocks the call that would start past the daily quota", async () => {
    const ai = createAi(deps({ openai: fakeProvider("openai", {}, calls) }));
    const req = { feature: "test", userId, system: "s", user: "u", schema, maxTokens: 100 };

    const first = await ai(req);                 // 0 used → allowed → 400 tokens
    expect(first.data).toEqual({ ok: true });
    expect(first.meta).toMatchObject({ provider: "openai", model: "gpt-4o", inputTokens: 300, outputTokens: 100 });
    expect(first.meta.costUsd).toBeCloseTo((300 * 2.5 + 100 * 10) / 1e6, 10);
    await ai(req);                               // 400 used → allowed → 800
    await ai(req);                               // 800 used → allowed → 1200
    await expect(ai(req)).rejects.toMatchObject({ code: "AI_QUOTA", status: 429 });
    expect(await tokensUsedToday(userId)).toBe(1_200);

    const rows = await prisma.aiUsage.findMany({ where: { userId } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "ok" && r.feature === "test")).toBe(true);
  });

  it("logs failed calls with their error code (and counts no tokens for them)", async () => {
    const u = (await prisma.user.create({ data: { email: `ai-err-${Date.now()}@test.local`, passwordHash: "x" } })).id;
    const ai = createAi(deps({ openai: fakeProvider("openai", new AiError("AI_UPSTREAM", "boom"), calls) }));
    await expect(ai({ feature: "test", userId: u, system: "s", user: "u", schema, maxTokens: 10 })).rejects.toMatchObject({ code: "AI_UPSTREAM" });
    const [row] = await prisma.aiUsage.findMany({ where: { userId: u } });
    expect(row).toMatchObject({ status: "error", errorCode: "AI_UPSTREAM", inputTokens: 0 });
  });

  it("bills tokens even when the model's answer fails validation", async () => {
    const u = (await prisma.user.create({ data: { email: `ai-bad-${Date.now()}@test.local`, passwordHash: "x" } })).id;
    const ai = createAi(deps({ openai: fakeProvider("openai", { text: "not json" }, calls) }));
    await expect(ai({ feature: "test", userId: u, system: "s", user: "u", schema, maxTokens: 10 })).rejects.toMatchObject({ code: "AI_BAD_JSON" });
    const [row] = await prisma.aiUsage.findMany({ where: { userId: u } });
    expect(row).toMatchObject({ status: "error", errorCode: "AI_BAD_JSON", inputTokens: 300, outputTokens: 100 });
  });

  it("routes to the user's chosen model, and to the admin vision model for image calls", async () => {
    await setAiSettings({ provider: "openai", model: "gpt-4o", visionProvider: "openai", visionModel: "gpt-4o-mini", defaultDailyTokenQuota: 200_000 });
    const u = (await prisma.user.create({ data: { email: `ai-route-${Date.now()}@test.local`, passwordHash: "x", aiProvider: "deepseek", aiModel: "deepseek-v4-pro" } })).id;
    const seen: string[] = [];
    const ai = createAi(deps({ openai: fakeProvider("openai", {}, seen), deepseek: fakeProvider("deepseek", {}, seen) }));

    const text = await ai({ feature: "t", userId: u, system: "s", user: "hi", schema, maxTokens: 10 });
    expect(text.meta).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro" });

    const image = await ai({ feature: "t", userId: u, system: "s", user: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }], schema, maxTokens: 10 });
    expect(image.meta).toMatchObject({ provider: "openai", model: "gpt-4o-mini", visionFallback: true });
    expect(seen).toEqual(["deepseek:deepseek-v4-pro", "openai:gpt-4o-mini"]);
  });

  it("settings reject models that are not in the catalog", async () => {
    await expect(setAiSettings({ provider: "openai", model: "gpt-9", visionProvider: "openai", visionModel: "gpt-4o", defaultDailyTokenQuota: 1 })).rejects.toMatchObject({ status: 400 });
  });

  it("the quota window resets at 00:00 UTC", () => {
    expect(startOfUtcDay(new Date("2026-09-28T23:59:59Z")).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });
});
