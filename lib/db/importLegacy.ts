import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withDerivedPnl } from "@/lib/journal/derive";
import type { LegacyData } from "@/lib/import/legacy";
import type { JournalEntry } from "@/lib/types/userData";
import { assertOwnedAttachments } from "./attachments";

const json = (v: unknown) => (v === undefined || v === null ? undefined : (v as Prisma.InputJsonValue));

/**
 * Idempotent import of v1 browser data. Rows are keyed by (userId, legacyId), so running the
 * import twice inserts nothing the second time. Images must already be uploaded as attachments.
 */
export async function importLegacyData(userId: string, data: LegacyData) {
  const attachmentIds = [
    ...data.journal.map((j) => j.screenshot?.attachmentId),
    ...data.chartLessons.flatMap((l) => l.charts.map((c) => c.image.attachmentId)),
  ].filter((x): x is string => !!x);
  await assertOwnedAttachments(userId, attachmentIds);

  return prisma.$transaction(async (tx) => {
    const counts = { watchlist: 0, alerts: 0, journal: 0, signals: 0, lessons: 0, chartLessons: 0 };

    if (data.watchlist.length && (await tx.watchlistItem.count({ where: { userId } })) === 0) {
      counts.watchlist = (await tx.watchlistItem.createMany({ data: data.watchlist.map((symbol, position) => ({ userId, symbol, position })), skipDuplicates: true })).count;
    }

    counts.alerts = (await tx.priceAlert.createMany({
      data: data.alerts.map((a) => ({ userId, legacyId: a.legacyId, symbol: a.symbol, targetPrice: a.targetPrice, condition: a.condition, triggered: a.triggered, triggeredAt: a.triggeredAt ?? null, createdAt: a.createdAt })),
      skipDuplicates: true,
    })).count;

    counts.journal = (await tx.journalEntry.createMany({
      data: data.journal.map((j) => {
        const d = withDerivedPnl({
          id: j.legacyId, timestamp: j.openedAt.toISOString(), symbol: j.symbol, position: j.position, entryPrice: j.entryPrice,
          exitPrice: j.exitPrice, pnlPercent: j.pnlPercent, feeRatePercent: j.feeRatePercent, pnlSource: j.pnlSource,
          emotion: j.emotion as JournalEntry["emotion"], notes: j.notes, leverage: j.leverage, margin: j.margin, marginMode: j.marginMode, status: j.status,
        });
        return {
          userId, legacyId: j.legacyId, symbol: j.symbol, position: j.position, status: d.status,
          entryPrice: j.entryPrice, exitPrice: j.exitPrice ?? null, pnlPercent: d.pnlPercent ?? null, grossPnlPercent: d.grossPnlPercent ?? j.grossPnlPercent ?? null,
          feeRatePercent: j.feeRatePercent ?? null, pnlSource: d.pnlSource ?? null, emotion: j.emotion, notes: j.notes,
          leverage: j.leverage ?? null, margin: j.margin ?? null, marginMode: j.marginMode ?? null,
          screenshotId: j.screenshot?.attachmentId ?? null, postMortem: json(j.postMortem),
          openedAt: j.openedAt, closedAt: d.status === "CLOSED" ? j.openedAt : null,
        };
      }),
      skipDuplicates: true,
    })).count;

    // A re-run may carry screenshots that failed to upload the first time: attach them to rows that
    // have none, and delete uploads that are not needed so no orphaned files are left behind.
    const unused: string[] = [];
    for (const j of data.journal) {
      const att = j.screenshot?.attachmentId;
      if (!att) continue;
      const row = await tx.journalEntry.findFirst({ where: { userId, legacyId: j.legacyId }, select: { id: true, screenshotId: true } });
      if (!row || row.screenshotId === att) continue;
      if (row.screenshotId) unused.push(att);
      else await tx.journalEntry.update({ where: { id: row.id }, data: { screenshotId: att } });
    }
    if (unused.length) await tx.attachment.deleteMany({ where: { userId, id: { in: unused } } });

    const legacyToId = new Map(
      (await tx.journalEntry.findMany({ where: { userId, legacyId: { not: null } }, select: { id: true, legacyId: true } }))
        .map((r) => [r.legacyId!, r.id]),
    );
    const takenTrades = new Set(
      (await tx.tradeLesson.findMany({ where: { userId, journalEntryId: { not: null } }, select: { journalEntryId: true } })).map((r) => r.journalEntryId!),
    );

    counts.signals = (await tx.signal.createMany({
      data: data.signals.map((s) => ({
        userId, legacyId: s.legacyId, symbol: s.symbol, timeframe: s.timeframe, signal: s.signal, confidence: s.confidence,
        priceAtSignal: s.priceAtSignal, entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit, tradeStyle: s.tradeStyle ?? null,
        riskManagement: json(s.riskManagement), reasoning: s.reasoning, indicatorsBreakdown: json(s.indicatorsBreakdown),
        provider: "openai", model: "legacy-v1", createdAt: s.createdAt,
      })),
      skipDuplicates: true,
    })).count;

    counts.lessons = (await tx.tradeLesson.createMany({
      data: data.lessons.map((l) => {
        const tradeId = l.journalLegacyId ? legacyToId.get(l.journalLegacyId) : undefined;
        const journalEntryId = tradeId && !takenTrades.has(tradeId) ? tradeId : null;
        if (journalEntryId) takenTrades.add(journalEntryId);
        return {
          userId, legacyId: l.legacyId, journalEntryId, symbol: l.symbol, position: l.position, outcome: l.outcome,
          pnlPercent: l.pnlPercent ?? null, timeframe: l.timeframe ?? null, rootCause: l.rootCause, mistakes: l.mistakes,
          strengths: l.strengths, lesson: l.lesson, tags: l.tags, emotion: l.emotion ?? null, createdAt: l.createdAt,
        };
      }),
      skipDuplicates: true,
    })).count;

    counts.chartLessons = (await tx.chartLesson.createMany({
      data: data.chartLessons.map((l) => ({
        userId, legacyId: l.legacyId, symbol: l.symbol ?? null, overallSignal: l.overallSignal, confluenceScore: l.confluenceScore,
        summary: l.summary, lesson: l.lesson, patterns: l.patterns, tags: l.tags, mistakes: l.mistakes, strengths: l.strengths,
        charts: l.charts
          .filter((c) => c.image.attachmentId)
          .map((c) => ({ timeframe: c.timeframe, attachmentId: c.image.attachmentId, annotations: c.annotations, signal: c.signal, bias: c.bias })) as Prisma.InputJsonValue,
        createdAt: l.createdAt,
      })),
      skipDuplicates: true,
    })).count;

    await tx.auditLog.create({ data: { userId, action: "import.legacy", meta: counts } });
    return counts;
  }, { timeout: 60_000 });
}
