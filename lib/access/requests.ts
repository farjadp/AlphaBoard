import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createInvite } from "@/lib/auth/createInvite";
import { badRequest, notFound } from "@/lib/http/errors";

export const AccessRequestInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(80).optional().transform((s) => s || undefined),
  note: z.string().trim().max(500).optional().transform((s) => s || undefined),
  /** Honeypot: humans never see or fill it. */
  website: z.string().max(200).optional(),
});

/**
 * Public waitlist. The answer is the same whether or not the email is already known, so the form
 * cannot be used to discover who has asked or who already has an account.
 */
export async function submitAccessRequest(input: z.output<typeof AccessRequestInput>, ip?: string) {
  if (input.website) return; // bot: accept silently, store nothing
  const existing = await prisma.accessRequest.findUnique({ where: { email: input.email } });
  if (existing) {
    if (existing.status === "PENDING" && (input.note || input.name)) {
      await prisma.accessRequest.update({ where: { id: existing.id }, data: { note: input.note ?? existing.note, name: input.name ?? existing.name } });
    }
    return;
  }
  await prisma.accessRequest.create({ data: { email: input.email, name: input.name, note: input.note, ip: ip ?? null } });
}

export async function listAccessRequests() {
  return prisma.accessRequest.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
}

/** Admin: create an email-bound invite for the request and mark it invited, atomically. */
export async function inviteFromRequest(adminId: string, id: string) {
  const req = await prisma.accessRequest.findUnique({ where: { id } });
  if (!req) throw notFound("Request not found");
  if (req.status !== "PENDING") throw badRequest("This request was already handled", "HANDLED");
  if (await prisma.user.findUnique({ where: { email: req.email }, select: { id: true } })) {
    await prisma.accessRequest.update({ where: { id }, data: { status: "DISMISSED", handledAt: new Date() } });
    throw badRequest("That email already has an account", "HAS_ACCOUNT");
  }
  const invite = await createInvite(adminId, { email: req.email, role: "USER" });
  await prisma.accessRequest.update({ where: { id }, data: { status: "INVITED", inviteId: invite.id, handledAt: new Date() } });
  return invite;
}

export async function dismissAccessRequest(adminId: string, id: string) {
  const res = await prisma.accessRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "DISMISSED", handledAt: new Date() } });
  if (res.count) await prisma.auditLog.create({ data: { userId: adminId, action: "admin.access_request_dismissed", target: id } });
}
