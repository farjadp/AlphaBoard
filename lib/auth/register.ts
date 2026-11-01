import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/client";
import { badRequest } from "@/lib/http/errors";
import { getAiSettings } from "@/lib/ai/settings";
import { hashInviteToken, inviteState } from "./invites";

/** Invite-only registration: the invite is single-use and may be bound to an email. Consumed atomically. */
export async function registerWithInvite(i: { token: string; name: string; email: string; password: string }, ip: string) {
  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashInviteToken(i.token) } });
  const state = inviteState(invite);
  if (state !== "valid") throw badRequest(`Invite is ${state}`, "INVITE_" + state.toUpperCase());
  if (invite!.email && invite!.email.toLowerCase() !== i.email) {
    throw badRequest("This invite was issued for a different email address", "INVITE_EMAIL_MISMATCH");
  }

  const existing = await prisma.user.findUnique({ where: { email: i.email } });
  if (existing) throw badRequest("An account with this email already exists", "EMAIL_TAKEN");

  const passwordHash = await bcrypt.hash(i.password, 12);
  const { defaultDailyTokenQuota } = await getAiSettings();
  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: i.name, email: i.email, passwordHash, role: invite!.role, dailyTokenQuota: defaultDailyTokenQuota },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    // Consume the invite atomically; a concurrent duplicate use fails on the unique usedById.
    await tx.invite.update({ where: { id: invite!.id, usedAt: null }, data: { usedAt: new Date(), usedById: created.id } });
    await tx.auditLog.create({ data: { userId: created.id, action: "auth.register", target: created.email, ip } });
    return created;
  });
}
