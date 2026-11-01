import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

/** One audit row per privileged action. `target` is the thing acted on (id, email, key); `meta` the details. */
export function audit(
  userId: string,
  action: string,
  extra: { target?: string | null; meta?: Prisma.InputJsonValue; ip?: string | null } = {},
) {
  return prisma.auditLog.create({
    data: { userId, action, target: extra.target ?? undefined, meta: extra.meta, ip: extra.ip ?? undefined },
  });
}
