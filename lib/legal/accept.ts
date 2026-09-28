import "server-only";
import { prisma } from "@/lib/prisma";

/** Record acceptance of the risk disclaimer once (first acceptance time is kept), with an audit entry. */
export async function acceptDisclaimer(userId: string, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { disclaimerAcceptedAt: true } });
    if (u.disclaimerAcceptedAt) return u.disclaimerAcceptedAt;
    const at = new Date();
    await tx.user.update({ where: { id: userId }, data: { disclaimerAcceptedAt: at } });
    await tx.auditLog.create({ data: { userId, action: "legal.disclaimer_accepted", ip: ip ?? null } });
    return at;
  });
}

export async function hasAcceptedDisclaimer(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { disclaimerAcceptedAt: true } });
  return !!u?.disclaimerAcceptedAt;
}
