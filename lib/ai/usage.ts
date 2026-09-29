import "server-only";
import { prisma } from "@/lib/prisma";

export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function tokensUsedToday(userId: string, now = new Date()): Promise<number> {
  const agg = await prisma.aiUsage.aggregate({
    where: { userId, createdAt: { gte: startOfUtcDay(now) } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
}

export interface UsageRow {
  userId: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: "ok" | "error";
  errorCode?: string;
  /** Requested model that declined; `model` is then the fallback that answered. */
  fallbackFrom?: string;
}

export async function recordUsage(row: UsageRow): Promise<void> {
  await prisma.aiUsage.create({ data: { ...row, errorCode: row.errorCode ?? null, fallbackFrom: row.fallbackFrom ?? null } });
}
