import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const [users, today] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, role: true, dailyTokenQuota: true, aiProvider: true, aiModel: true, createdAt: true } }),
    prisma.aiUsage.groupBy({ by: ["userId"], where: { createdAt: { gte: startOfUtcDay() } }, _sum: { inputTokens: true, outputTokens: true, costUsd: true } }),
  ]);
  const used = new Map(today.map((t) => [t.userId, { tokens: (t._sum.inputTokens ?? 0) + (t._sum.outputTokens ?? 0), costUsd: t._sum.costUsd ?? 0 }]));
  return NextResponse.json({ users: users.map((u) => ({ ...u, today: used.get(u.id) ?? { tokens: 0, costUsd: 0 } })) });
});
