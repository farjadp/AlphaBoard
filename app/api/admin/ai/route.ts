import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/auth/dal";
import { readJson } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { MODELS, PROVIDERS } from "@/lib/ai/catalog";
import { configuredProviders } from "@/lib/ai/configured";
import { AiSettingsInput, getAiSettings, setAiSettings } from "@/lib/ai/settings";
import { adminUsageSummary } from "@/lib/ai/usageReport";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const configured = configuredProviders();
  return NextResponse.json({
    settings: await getAiSettings(),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, envKey: p.envKey, configured: configured.has(id as never) })),
    models: MODELS,
    usage: await adminUsageSummary(7),
  });
});

export const PUT = route(async (req) => {
  const admin = await requireAdmin();
  const saved = await setAiSettings(AiSettingsInput.parse(await readJson(req, 2_000)));
  await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.ai_settings", meta: { ...saved } } });
  return NextResponse.json({ settings: saved });
});
