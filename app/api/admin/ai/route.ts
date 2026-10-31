import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { MODELS, PROVIDERS } from "@/lib/ai/catalog";
import { configuredProviders } from "@/lib/ai/configured";
import { AiSettingsInput, getAiSettings, setAiSettings } from "@/lib/ai/settings";
import { adminUsageSummary } from "@/lib/ai/usageReport";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_req, _admin) => {
  const configured = configuredProviders();
  return NextResponse.json({
    settings: await getAiSettings(),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, envKey: p.envKey, configured: configured.has(id as never) })),
    models: MODELS,
    usage: await adminUsageSummary(7),
  });
});

export const PUT = adminRoute(async (req, admin) => {
  const saved = await setAiSettings(AiSettingsInput.parse(await readJson(req, 2_000)));
  await audit(admin.id, "admin.ai_settings", { meta: { ...saved } });
  return NextResponse.json({ settings: saved });
});
