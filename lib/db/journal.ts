import "server-only";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/http/errors";
import { withDerivedPnl } from "@/lib/journal/derive";
import type { JournalEntry } from "@/lib/types/userData";
import type { JournalCreateInput, JournalPatchInput } from "./inputs";
import { journalToDto } from "./mappers";
import { attachmentIdFromUrl, createAttachment, deleteAttachments } from "./attachments";

/** Columns derived from a DTO after PnL/status recomputation. */
function derivedColumns(dto: JournalEntry) {
  const d = withDerivedPnl(dto);
  return {
    status: d.status,
    pnlPercent: d.pnlPercent ?? null,
    grossPnlPercent: d.grossPnlPercent ?? null,
    pnlSource: d.pnlSource ?? null,
  };
}

export async function listJournal(userId: string) {
  const rows = await prisma.journalEntry.findMany({ where: { userId }, orderBy: { openedAt: "desc" }, take: 2_000 });
  return rows.map(journalToDto);
}

export async function createJournalEntry(userId: string, input: z.output<typeof JournalCreateInput>) {
  const exchange = input.pnlSource === "exchange" && typeof input.pnlPercent === "number";
  const draft: JournalEntry = {
    id: "new", timestamp: new Date().toISOString(), status: "OPEN", ...input,
    pnlSource: exchange ? "exchange" : undefined,
    pnlPercent: exchange ? input.pnlPercent : undefined,
  };
  const derived = derivedColumns(draft);
  const row = await prisma.journalEntry.create({
    data: {
      userId,
      symbol: input.symbol,
      position: input.position,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice ?? null,
      feeRatePercent: input.feeRatePercent ?? null,
      emotion: input.emotion,
      notes: input.notes,
      leverage: input.leverage ?? null,
      margin: input.margin ?? null,
      marginMode: input.marginMode ?? null,
      ...derived,
      closedAt: derived.status === "CLOSED" ? new Date() : null,
    },
  });
  return journalToDto(row);
}

export async function updateJournalEntry(userId: string, id: string, patch: z.output<typeof JournalPatchInput>) {
  const existing = await prisma.journalEntry.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Journal entry not found");

  const { screenshotUrl, postMortem, ...fields } = patch;
  let screenshotId = existing.screenshotId;
  let replacedScreenshot: string | null = null;
  if (screenshotUrl === null) {
    replacedScreenshot = existing.screenshotId;
    screenshotId = null;
  } else if (typeof screenshotUrl === "string" && screenshotUrl.startsWith("data:")) {
    screenshotId = (await createAttachment(userId, screenshotUrl)).id;
    replacedScreenshot = existing.screenshotId;
  } else if (typeof screenshotUrl === "string" && attachmentIdFromUrl(screenshotUrl) !== existing.screenshotId) {
    // Pointing at some other URL is not allowed; keep the current screenshot.
  }

  const merged: JournalEntry = { ...journalToDto(existing), ...(fields as Partial<JournalEntry>) };
  const derived = derivedColumns(merged);
  const row = await prisma.journalEntry.update({
    where: { id },
    data: {
      ...fields,
      ...derived,
      screenshotId,
      ...(postMortem !== undefined ? { postMortem: postMortem as Prisma.InputJsonValue } : {}),
      closedAt: derived.status === "CLOSED" ? existing.closedAt ?? new Date() : null,
    },
  });
  if (replacedScreenshot) await deleteAttachments(userId, [replacedScreenshot]);
  return journalToDto(row);
}

export async function deleteJournalEntry(userId: string, id: string) {
  const row = await prisma.journalEntry.findFirst({ where: { id, userId }, select: { screenshotId: true } });
  if (!row) return;
  await prisma.journalEntry.delete({ where: { id } });
  await deleteAttachments(userId, [row.screenshotId]);
}

export async function clearJournal(userId: string) {
  const shots = await prisma.journalEntry.findMany({ where: { userId, screenshotId: { not: null } }, select: { screenshotId: true } });
  await prisma.journalEntry.deleteMany({ where: { userId } });
  await deleteAttachments(userId, shots.map((s) => s.screenshotId));
}
