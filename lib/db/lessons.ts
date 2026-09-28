import "server-only";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { LessonInput } from "./inputs";
import { lessonToDto } from "./mappers";

export async function listLessons(userId: string) {
  const rows = await prisma.tradeLesson.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map(lessonToDto);
}

/** One lesson per trade: re-running a post-mortem replaces the previous lesson for that trade. */
export async function saveLesson(userId: string, input: z.output<typeof LessonInput>) {
  const { tradeId, ...data } = input;
  const trade = tradeId ? await prisma.journalEntry.findFirst({ where: { id: tradeId, userId }, select: { id: true } }) : null;
  const row = trade
    ? await prisma.tradeLesson.upsert({
        where: { journalEntryId: trade.id },
        create: { userId, journalEntryId: trade.id, ...data },
        update: { ...data, createdAt: new Date() },
      })
    : await prisma.tradeLesson.create({ data: { userId, ...data } });
  return lessonToDto(row);
}

export async function deleteLesson(userId: string, id: string) {
  await prisma.tradeLesson.deleteMany({ where: { id, userId } });
}

export async function clearLessons(userId: string) {
  await prisma.tradeLesson.deleteMany({ where: { userId } });
}

/** Most relevant lessons for the strategy prompt: same symbol first, then most recent. */
export async function lessonsForPrompt(userId: string, symbol: string, limit = 6) {
  const [same, others] = await Promise.all([
    prisma.tradeLesson.findMany({ where: { userId, symbol }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.tradeLesson.findMany({ where: { userId, symbol: { not: symbol } }, orderBy: { createdAt: "desc" }, take: limit }),
  ]);
  return [...same, ...others].slice(0, limit).map((l) => ({
    symbol: l.symbol, position: l.position, outcome: l.outcome, pnlPercent: l.pnlPercent ?? undefined,
    rootCause: l.rootCause, lesson: l.lesson, tags: l.tags,
  }));
}
