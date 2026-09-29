import "server-only";
import { prisma } from "@/lib/prisma";
import type { DailyUsageDto } from "@/lib/types/sessions";

export const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Sessions started today (UTC) and today's net realized loss across them (spec E19). */
export async function dailyUsage(userId: string, now = new Date()): Promise<DailyUsageDto> {
  const since = startOfUtcDay(now);
  const [agg, limits] = await Promise.all([
    prisma.tradingSession.aggregate({ where: { userId, startedAt: { gte: since } }, _count: true, _sum: { realizedPnl: true, fees: true } }),
    prisma.userTradingLimits.findUnique({ where: { userId } }),
  ]);
  const net = (agg._sum.realizedPnl ?? 0) - (agg._sum.fees ?? 0);
  return {
    sessionsToday: agg._count,
    lossToday: Math.max(0, -net),
    limits: { maxDailyLoss: limits?.maxDailyLoss ?? null, maxSessionsPerDay: limits?.maxSessionsPerDay ?? null },
  };
}

export async function setLimits(userId: string, l: { maxDailyLoss: number | null; maxSessionsPerDay: number | null }) {
  await prisma.userTradingLimits.upsert({ where: { userId }, create: { userId, ...l }, update: l });
  return dailyUsage(userId);
}
