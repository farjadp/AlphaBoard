import "server-only";
import { prisma } from "@/lib/prisma";
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
