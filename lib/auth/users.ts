import "server-only";
import { prisma } from "@/lib/db/client";
import { notFound } from "@/lib/http/errors";
import { startOfUtcDay } from "@/lib/ai/usage";

/** Every user with today's AI token use and cost (admin list). */
export async function listUsersWithUsageToday(now = new Date()) {
  const [users, today] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, role: true, dailyTokenQuota: true, aiProvider: true, aiModel: true, createdAt: true } }),
    prisma.aiUsage.groupBy({ by: ["userId"], where: { createdAt: { gte: startOfUtcDay(now) } }, _sum: { inputTokens: true, outputTokens: true, costUsd: true } }),
  ]);
  const used = new Map(today.map((t) => [t.userId, { tokens: (t._sum.inputTokens ?? 0) + (t._sum.outputTokens ?? 0), costUsd: t._sum.costUsd ?? 0 }]));
  return users.map((u) => ({ ...u, today: used.get(u.id) ?? { tokens: 0, costUsd: 0 } }));
}

/** Set a user's daily AI token allowance (0 turns AI off for them). */
export async function setUserQuota(id: string, dailyTokenQuota: number) {
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound("User not found");
  return prisma.user.update({ where: { id }, data: { dailyTokenQuota }, select: { id: true, email: true, dailyTokenQuota: true } });
}

/** The user's own model choice and allowance. */
export function userAiPreference(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { aiProvider: true, aiModel: true, dailyTokenQuota: true } });
}

export async function setUserAiPreference(userId: string, provider: string | null, model: string | null) {
  await prisma.user.update({ where: { id: userId }, data: { aiProvider: provider, aiModel: model } });
}
