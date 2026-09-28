import "server-only";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { ChartLessonInput } from "./inputs";
import { chartLessonToDto } from "./mappers";
import { attachmentIdFromUrl, createAttachment, deleteAttachments } from "./attachments";

const MAX_CHART_LESSONS = 200;

function attachmentIds(charts: unknown): string[] {
  return (Array.isArray(charts) ? charts : [])
    .map((c) => (c as { attachmentId?: unknown })?.attachmentId)
    .filter((x): x is string => typeof x === "string");
}

export async function listChartLessons(userId: string) {
  const rows = await prisma.chartLesson.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_CHART_LESSONS });
  return rows.map(chartLessonToDto);
}

export async function createChartLesson(userId: string, input: z.output<typeof ChartLessonInput>) {
  const created: string[] = [];
  try {
    const charts = [];
    for (const c of input.charts) {
      // Re-saving an already stored chart keeps its attachment; a new screenshot becomes one.
      const existing = attachmentIdFromUrl(c.imageDataUrl);
      const owned = existing ? await prisma.attachment.count({ where: { id: existing, userId } }) : 0;
      const attachmentId = owned ? existing! : (await createAttachment(userId, c.imageDataUrl)).id;
      if (!owned) created.push(attachmentId);
      charts.push({ timeframe: c.timeframe, attachmentId, annotations: c.annotations, signal: c.signal, bias: c.bias });
    }
    const { charts: _ignored, ...fields } = input;
    const row = await prisma.chartLesson.create({
      data: { userId, ...fields, symbol: fields.symbol ?? null, charts: charts as Prisma.InputJsonValue },
    });
    return chartLessonToDto(row);
  } catch (e) {
    await deleteAttachments(userId, created); // no orphans on failure
    throw e;
  }
}

export async function deleteChartLesson(userId: string, id: string) {
  const row = await prisma.chartLesson.findFirst({ where: { id, userId }, select: { charts: true } });
  if (!row) return;
  await prisma.chartLesson.delete({ where: { id } });
  await deleteAttachments(userId, attachmentIds(row.charts));
}

export async function clearChartLessons(userId: string) {
  const rows = await prisma.chartLesson.findMany({ where: { userId }, select: { charts: true } });
  await prisma.chartLesson.deleteMany({ where: { userId } });
  await deleteAttachments(userId, rows.flatMap((r) => attachmentIds(r.charts)));
}

/** Text-only summaries for the strategy prompt (never the images). */
export async function chartLessonsForPrompt(userId: string, limit = 5) {
  const rows = await prisma.chartLesson.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((l) => ({ symbol: l.symbol ?? undefined, signal: l.overallSignal, confluenceScore: l.confluenceScore, lesson: l.lesson, patterns: l.patterns, tags: l.tags }));
}
