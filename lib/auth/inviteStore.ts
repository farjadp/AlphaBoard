import "server-only";
import { prisma } from "@/lib/db/client";
import { generateInviteToken, hashInviteToken, inviteExpiry, inviteUrl } from "./invites";

/** Creates an invite and audits it. The raw token only exists in the returned URL (never stored). */
export async function createInvite(adminId: string, data: { email?: string; role: "USER" | "ADMIN"; days?: number }) {
  const token = generateInviteToken();
  const invite = await prisma.invite.create({
    data: { tokenHash: hashInviteToken(token), email: data.email, role: data.role, createdById: adminId, expiresAt: inviteExpiry(new Date(), data.days) },
  });
  await prisma.auditLog.create({
    data: { userId: adminId, action: "admin.invite_created", target: data.email ?? invite.id, meta: { role: data.role } },
  });
  return { id: invite.id, url: inviteUrl(token), expiresAt: invite.expiresAt };
}

/** Latest invites with who created and who used them (admin list). */
export function listInvites(take = 100) {
  return prisma.invite.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { createdBy: { select: { email: true } }, usedBy: { select: { email: true } } },
  });
}

/** Revoke an unused invite; true when one was revoked. */
export async function revokeInvite(id: string): Promise<boolean> {
  const res = await prisma.invite.deleteMany({ where: { id, usedAt: null } });
  return res.count === 1;
}
