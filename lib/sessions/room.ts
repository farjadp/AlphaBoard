import "server-only";
import type { Prisma, SessionMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/http/errors";
import type { SessionMessageDto, SessionMessageKind, SessionRole } from "@/lib/types/sessions";

/** Append a message to a session's room (agents, risk, executor, system and the owner all speak here). */
export async function post(
  sessionId: string, role: SessionRole, kind: SessionMessageKind, body: string,
  data?: Record<string, unknown> | null, extra: { costUsd?: number; cycle?: number } = {},
) {
  return prisma.sessionMessage.create({
    data: {
      sessionId, role, kind, body: body.slice(0, 4_000),
      data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
      costUsd: extra.costUsd, cycle: extra.cycle,
    },
  });
}

export const messageToDto = (m: SessionMessage): SessionMessageDto => ({
  id: m.id, role: m.role, kind: m.kind, body: m.body, data: m.data, costUsd: m.costUsd, cycle: m.cycle, createdAt: m.createdAt.toISOString(),
});

/** Messages after a cursor (message id), oldest first. Owner only. */
export async function listMessages(userId: string, sessionId: string, after?: string | null, limit = 200) {
  const owned = await prisma.tradingSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!owned) throw notFound("Session not found");
  let since: { createdAt: Date; id: string } | null = null;
  if (after) since = await prisma.sessionMessage.findFirst({ where: { id: after, sessionId }, select: { createdAt: true, id: true } });
  const rows = await prisma.sessionMessage.findMany({
    where: {
      sessionId,
      ...(since ? { OR: [{ createdAt: { gt: since.createdAt } }, { createdAt: since.createdAt, id: { gt: since.id } }] } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(limit, 1), 500),
  });
  return rows.map(messageToDto);
}
