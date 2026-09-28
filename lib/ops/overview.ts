import "server-only";
import { prisma } from "@/lib/prisma";
import { adminUsageSummary } from "@/lib/ai/usageReport";
import { configuredProviders } from "@/lib/ai/configured";
import { findModel, PROVIDERS } from "@/lib/ai/catalog";
import { getAiSettings } from "@/lib/ai/settings";
import { TICK_HISTORY_KEY, TICK_KEY, type TickResult } from "@/lib/jobs/tick";
import { overallStatus, tickHealth } from "./health";
import { recentEvents } from "./events";

const startedAt = Date.now();

/** Everything the admin System page shows, gathered in parallel. Each figure is real or explicitly null. */
export async function systemOverview(now = new Date()) {
  let db = true;
  try { await prisma.$queryRaw`SELECT 1`; } catch { db = false; }
  if (!db) return { db: false as const, now: now.toISOString() };

  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [
    lastRow, historyRow, events, errorsLastHour,
    users, newUsers, admins, accepted, telegramLinked, pendingRequests, validInvites,
    openPositions, paperAccounts, activeAlerts, pendingSignals, resolvedSignals7d,
    usage, ai,
  ] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: TICK_KEY } }),
    prisma.appSetting.findUnique({ where: { key: TICK_HISTORY_KEY } }),
    recentEvents(30),
    prisma.systemEvent.count({ where: { level: "error", lastAt: { gte: hourAgo } } }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.count({ where: { disclaimerAcceptedAt: { not: null } } }),
    prisma.user.count({ where: { telegramChatId: { not: null } } }),
    prisma.accessRequest.count({ where: { status: "PENDING" } }),
    prisma.invite.count({ where: { usedAt: null, expiresAt: { gt: now } } }),
    prisma.paperPosition.count({ where: { closedAt: null } }),
    prisma.paperAccount.count(),
    prisma.priceAlert.count({ where: { triggered: false } }),
    prisma.signal.count({ where: { signal: { in: ["BUY", "SELL"] }, OR: [{ evaluation: null }, { evaluation: { status: "OPEN" } }] } }),
    prisma.signalEvaluation.count({ where: { status: { in: ["TP_HIT", "SL_HIT", "EXPIRED"] }, resolvedAt: { gte: weekAgo } } }),
    adminUsageSummary(7),
    getAiSettings(),
  ]);

  const last = (lastRow?.value ?? null) as unknown as TickResult | null;
  const tick = tickHealth(last, now);
  const history = (Array.isArray(historyRow?.value) ? historyRow.value : []) as Array<{ at: string; ms: number; errors: number }>;
  const configured = configuredProviders();
  const today = now.toISOString().slice(0, 10);

  return {
    db: true as const,
    now: now.toISOString(),
    status: overallStatus({ db, tick: tick.state, errorsLastHour }),
    errorsLastHour,
    runtime: {
      version: process.env.APP_VERSION ?? process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      node: process.version,
      schedulerEnabled: process.env.TICK_DISABLED !== "1",
      cronSecret: !!process.env.CRON_SECRET,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN?.trim(),
    },
    tick: { ...tick, last, history },
    people: { users, newUsers, admins, accepted, telegramLinked, pendingRequests, validInvites },
    workload: { openPositions, paperAccounts, activeAlerts, pendingSignals, resolvedSignals7d },
    ai: {
      defaultModel: findModel(ai.provider, ai.model)?.label ?? `${ai.provider}/${ai.model}`,
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, configured: configured.has(id as never) })),
      week: usage.total,
      todayCostUsd: usage.byDay.find((d) => d.key === today)?.costUsd ?? 0,
      todayCalls: usage.byDay.find((d) => d.key === today)?.calls ?? 0,
    },
    events: events.map((e) => ({
      id: e.id, level: e.level, source: e.source, message: e.message, count: e.count, requestId: e.requestId,
      firstAt: e.firstAt.toISOString(), lastAt: e.lastAt.toISOString(),
    })),
  };
}

export type SystemOverview = Awaited<ReturnType<typeof systemOverview>>;
