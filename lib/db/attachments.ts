import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/http/errors";
import { parseImageDataUrl } from "@/lib/http/images";
import { attachmentUrl } from "./mappers";

type Tx = Prisma.TransactionClient;

export async function createAttachment(userId: string, dataUrl: string, db: Tx = prisma) {
  const { mime } = parseImageDataUrl(dataUrl);
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const row = await db.attachment.create({ data: { userId, mime, bytes, size: bytes.length }, select: { id: true } });
  return { id: row.id, url: attachmentUrl(row.id) };
}

export function getAttachment(userId: string, id: string) {
  return prisma.attachment.findFirst({ where: { id, userId }, select: { mime: true, bytes: true, size: true } });
}

/** Loads an owned attachment back as a data URL (e.g. to send a stored screenshot to the model). */
export async function attachmentAsDataUrl(userId: string, id: string): Promise<string | null> {
  const a = await getAttachment(userId, id);
  return a ? `data:${a.mime};base64,${Buffer.from(a.bytes).toString("base64")}` : null;
}

export async function assertOwnedAttachments(userId: string, ids: string[], db: Tx = prisma) {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return;
  const owned = await db.attachment.count({ where: { userId, id: { in: unique } } });
  if (owned !== unique.length) throw badRequest("Unknown attachment", "BAD_ATTACHMENT");
}

export function deleteAttachments(userId: string, ids: Array<string | null | undefined>, db: Tx = prisma) {
  const clean = ids.filter((x): x is string => !!x);
  return clean.length ? db.attachment.deleteMany({ where: { userId, id: { in: clean } } }) : Promise.resolve({ count: 0 });
}

/** "/api/attachments/{id}" → id (only for our own URL shape). */
export function attachmentIdFromUrl(url: string | null | undefined): string | null {
  const m = /^\/api\/attachments\/([a-z0-9]{20,40})$/i.exec(url ?? "");
  return m ? m[1] : null;
}
