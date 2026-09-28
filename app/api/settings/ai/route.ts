import { NextResponse } from "next/server";
import { z } from "zod";
import { userRoute } from "@/lib/http/userRoute";
import { badRequest, readJson } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { MODELS, PROVIDERS, findModel, resolveModel } from "@/lib/ai/catalog";
import { configuredProviders } from "@/lib/ai/configured";
import { getAiSettings } from "@/lib/ai/settings";
import { userUsageToday } from "@/lib/ai/usageReport";

export const dynamic = "force-dynamic";

async function view(userId: string) {
  const [settings, user, usage] = await Promise.all([
    getAiSettings(),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { aiProvider: true, aiModel: true, dailyTokenQuota: true } }),
    userUsageToday(userId),
  ]);
  const configured = configuredProviders();
  let effective: { provider: string; model: string; label: string } | null = null;
  let vision: { provider: string; model: string; label: string } | null = null;
  try {
    const r = resolveModel({ settings, configured, needsVision: false, userPref: { provider: user.aiProvider, model: user.aiModel } });
    effective = { provider: r.provider, model: r.model, label: r.info.label };
    const v = resolveModel({ settings, configured, needsVision: true, userPref: { provider: user.aiProvider, model: user.aiModel } });
    vision = { provider: v.provider, model: v.model, label: v.info.label };
  } catch {
    // no provider configured: effective stays null
  }
  return {
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, configured: configured.has(id as never) })),
    models: MODELS.map((m) => ({ provider: m.provider, id: m.id, label: m.label, vision: m.vision, priceInPerM: m.priceInPerM, priceOutPerM: m.priceOutPerM })),
    preference: user.aiProvider && user.aiModel ? { provider: user.aiProvider, model: user.aiModel } : null,
    defaults: { provider: settings.provider, model: settings.model, label: findModel(settings.provider, settings.model)?.label ?? settings.model },
    effective,
    vision,
    usage: { ...usage, quota: user.dailyTokenQuota },
  };
}

export const GET = userRoute(async (_req, user) => NextResponse.json(await view(user.id)));

const Body = z.object({ provider: z.string().max(20).nullable(), model: z.string().max(80).nullable() });

/** Choose a model, or send nulls to follow the workspace default. */
export const PUT = userRoute(async (req, user) => {
  const { provider, model } = Body.parse(await readJson(req, 1_000));
  if (provider !== null || model !== null) {
    const m = findModel(provider, model);
    if (!m) throw badRequest("Unknown model", "BAD_MODEL");
    if (!configuredProviders().has(m.provider)) throw badRequest(`${PROVIDERS[m.provider].label} is not configured on this server`, "PROVIDER_UNAVAILABLE");
  }
  await prisma.user.update({ where: { id: user.id }, data: { aiProvider: provider, aiModel: model } });
  return NextResponse.json(await view(user.id));
});
