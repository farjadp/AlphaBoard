import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { readJson } from "@/lib/http/errors";
import { DEFAULT_POST_TEMPLATE, TEMPLATE_FIELDS } from "@/lib/signals/format";
import { channelUsername, getPostTemplate, resetPostTemplate, savePostTemplate } from "@/lib/signals/template";

export const dynamic = "force-dynamic";

/** The channel post template, its fields and the default. */
export const GET = adminRoute(async (_req, _admin) => {
  return NextResponse.json({ ...(await getPostTemplate()), defaultTemplate: DEFAULT_POST_TEMPLATE, fields: TEMPLATE_FIELDS, channel: channelUsername() });
});

export const PUT = adminRoute(async (req, admin) => {
  const { template } = z.object({ template: z.string().max(4_000) }).parse(await readJson(req, 20_000));
  await savePostTemplate(template);
  await audit(admin.id, "signal_desk.template_save");
  return NextResponse.json(await getPostTemplate());
});

/** Back to the built-in template. */
export const DELETE = adminRoute(async (req, admin) => {
  await resetPostTemplate();
  await audit(admin.id, "signal_desk.template_reset");
  return NextResponse.json(await getPostTemplate());
});
