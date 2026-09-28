import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { fingerprint } from "./health";

const DEDUPE_MS = 10 * 60_000;
const RETENTION_DAYS = 14;

export interface NewEvent {
  level?: "error" | "warn";
  source: "http" | "render" | "tick" | "scheduler";
  message: string;
  requestId?: string;
  meta?: Record<string, unknown>;
}

/** Record an operational event. Never throws: observability must not break the request that failed. */
export async function recordEvent(e: NewEvent, now = new Date()) {
  try {
    const message = e.message.slice(0, 500);
    const fp = fingerprint(e.source, message);
    const recent = await prisma.systemEvent.findFirst({
      where: { fingerprint: fp, lastAt: { gte: new Date(now.getTime() - DEDUPE_MS) } },
      orderBy: { lastAt: "desc" }, select: { id: true },
    });
    if (recent) {
      await prisma.systemEvent.update({ where: { id: recent.id }, data: { count: { increment: 1 }, lastAt: now, requestId: e.requestId ?? undefined } });
    } else {
      await prisma.systemEvent.create({
        data: {
          level: e.level ?? "error", source: e.source, message, fingerprint: fp, requestId: e.requestId ?? null,
          meta: (e.meta ?? undefined) as Prisma.InputJsonValue | undefined, firstAt: now, lastAt: now,
        },
      });
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "could not record system event");
  }
}

export async function pruneEvents(now = new Date()) {
  await prisma.systemEvent.deleteMany({ where: { lastAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 86_400_000) } } });
}

export async function recentEvents(limit = 30) {
  return prisma.systemEvent.findMany({ orderBy: { lastAt: "desc" }, take: limit });
}
