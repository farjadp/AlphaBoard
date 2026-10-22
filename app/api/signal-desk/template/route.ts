import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { DEFAULT_POST_TEMPLATE, TEMPLATE_FIELDS } from "@/lib/signals/format";
import { channelUsername, getPostTemplate, resetPostTemplate, savePostTemplate } from "@/lib/signals/template";

export const dynamic = "force-dynamic";

/** The channel post template, its fields and the default. */
export const GET = route(async (req) => {
  await requireAdmin();
  enforceRateLimit(req, "api");
  return NextResponse.json({ ...(await getPostTemplate()), defaultTemplate: DEFAULT_POST_TEMPLATE, fields: TEMPLATE_FIELDS, channel: channelUsername() });
});

export const PUT = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const { template } = z.object({ template: z.string().max(4_000) }).parse(await readJson(req, 20_000));
  await savePostTemplate(template);
  await prisma.auditLog.create({ data: { userId: admin.id, action: "signal_desk.template_save" } });
  return NextResponse.json(await getPostTemplate());
});

/** Back to the built-in template. */
export const DELETE = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  await resetPostTemplate();
  await prisma.auditLog.create({ data: { userId: admin.id, action: "signal_desk.template_reset" } });
  return NextResponse.json(await getPostTemplate());
});
