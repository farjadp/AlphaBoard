import { env } from "@/lib/env";
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/http/errors";
import { DEFAULT_POST_TEMPLATE, templateProblems } from "./format";

/** The channel post template (Admin → Signals), one for the whole desk since there is one channel. */
const TEMPLATE_KEY = "signalDesk.postTemplate";

export async function getPostTemplate(): Promise<{ template: string; isDefault: boolean }> {
  const row = await prisma.appSetting.findUnique({ where: { key: TEMPLATE_KEY } });
  const t = (row?.value as { template?: unknown } | null)?.template;
  return typeof t === "string" && t.trim() ? { template: t, isDefault: false } : { template: DEFAULT_POST_TEMPLATE, isDefault: true };
}

export async function savePostTemplate(template: string): Promise<void> {
  const problems = templateProblems(template);
  if (problems.length) throw badRequest(problems.join("; "));
  const value = { template } as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: TEMPLATE_KEY }, create: { key: TEMPLATE_KEY, value }, update: { value } });
}

export async function resetPostTemplate(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: TEMPLATE_KEY } });
}

export const channelUsername = () => env().SIGNAL_CHANNEL_USERNAME ?? null;
