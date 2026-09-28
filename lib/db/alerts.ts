import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { badRequest } from "@/lib/http/errors";
import type { AlertInput } from "./inputs";
import { alertToDto } from "./mappers";

export async function listAlerts(userId: string) {
  const rows = await prisma.priceAlert.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map(alertToDto);
}

export async function createAlert(userId: string, input: z.output<typeof AlertInput>) {
  if (!findAsset(input.symbol)) throw badRequest("Unsupported symbol", "BAD_SYMBOL");
  const count = await prisma.priceAlert.count({ where: { userId, triggered: false } });
  if (count >= 200) throw badRequest("Too many active alerts (max 200)", "LIMIT");
  return alertToDto(await prisma.priceAlert.create({ data: { userId, ...input } }));
}

export async function deleteAlert(userId: string, id: string) {
  await prisma.priceAlert.deleteMany({ where: { id, userId } });
}

/** Idempotent: only the first trigger is recorded. */
export async function markAlertTriggered(userId: string, id: string) {
  await prisma.priceAlert.updateMany({ where: { id, userId, triggered: false }, data: { triggered: true, triggeredAt: new Date() } });
  const row = await prisma.priceAlert.findFirst({ where: { id, userId } });
  return row ? alertToDto(row) : null;
}
