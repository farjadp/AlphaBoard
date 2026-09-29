import "server-only";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "./usage";

export async function userUsageToday(userId: string) {
  const since = startOfUtcDay();
  const agg = await prisma.aiUsage.aggregate({
    where: { userId, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    _count: true,
  });
  return {
    tokens: (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0),
    costUsd: agg._sum.costUsd ?? 0,
    calls: agg._count,
    resetsAt: new Date(since.getTime() + 86_400_000).toISOString(),
  };
}

type Group = { key: string; calls: number; errors: number; fallbacks: number; tokens: number; costUsd: number };

function group(rows: Array<{ key: string; status: string; fallbackFrom: string | null; inputTokens: number; outputTokens: number; costUsd: number }>): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const g = m.get(r.key) ?? { key: r.key, calls: 0, errors: 0, fallbacks: 0, tokens: 0, costUsd: 0 };
    g.calls++;
    if (r.status !== "ok") g.errors++;
    if (r.fallbackFrom) g.fallbacks++;
    g.tokens += r.inputTokens + r.outputTokens;
    g.costUsd += r.costUsd;
    m.set(r.key, g);
  }
  return [...m.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

/** Last N days of usage, grouped for the admin dashboard. */
export async function adminUsageSummary(days = 7) {
  const since = new Date(startOfUtcDay().getTime() - (days - 1) * 86_400_000);
  const rows = await prisma.aiUsage.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, feature: true, provider: true, model: true, status: true, fallbackFrom: true, inputTokens: true, outputTokens: true, costUsd: true, user: { select: { email: true } } },
    take: 50_000,
  });
  const base = (key: string, r: (typeof rows)[number]) => ({ key, status: r.status, fallbackFrom: r.fallbackFrom, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd });
  const total = group(rows.map((r) => base("all", r)))[0] ?? { key: "all", calls: 0, errors: 0, fallbacks: 0, tokens: 0, costUsd: 0 };
  return {
    since: since.toISOString(),
    total,
    byDay: group(rows.map((r) => base(r.createdAt.toISOString().slice(0, 10), r))).sort((a, b) => a.key.localeCompare(b.key)),
    byUser: group(rows.map((r) => base(r.user.email, r))),
    byModel: group(rows.map((r) => base(`${r.provider}/${r.fallbackFrom ? `${r.fallbackFrom} → ` : ""}${r.model}`, r))),
    byFeature: group(rows.map((r) => base(r.feature, r))),
  };
}
