import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/http/route";
import { badRequest, readJson, tooManyRequests } from "@/lib/http/errors";
import { clientIp, limiters } from "@/lib/http/rateLimit";
import { hashInviteToken, inviteState } from "@/lib/auth/invites";

const registerSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().email("Invalid email format").transform((s) => s.trim().toLowerCase()),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
});

/** Invite-only registration. The invite token is single-use and may be bound to an email. */
export const POST = route(async (req) => {
  const rl = limiters.auth.check(clientIp(req));
  if (!rl.allowed) throw tooManyRequests(rl.retryAfterMs);

  const body = await readJson(req, 10_000);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", code: "VALIDATION", errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { token, name, email, password } = parsed.data;

  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashInviteToken(token) } });
  const state = inviteState(invite);
  if (state !== "valid") throw badRequest(`Invite is ${state}`, "INVITE_" + state.toUpperCase());
  if (invite!.email && invite!.email.toLowerCase() !== email) {
    throw badRequest("This invite was issued for a different email address", "INVITE_EMAIL_MISMATCH");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw badRequest("An account with this email already exists", "EMAIL_TAKEN");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name, email, passwordHash, role: invite!.role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    // Consume the invite atomically; a concurrent duplicate use fails on the unique usedById.
    await tx.invite.update({ where: { id: invite!.id, usedAt: null }, data: { usedAt: new Date(), usedById: created.id } });
    await tx.auditLog.create({ data: { userId: created.id, action: "auth.register", target: created.email, ip: clientIp(req) } });
    return created;
  });

  return NextResponse.json({ message: "Account created", user }, { status: 201 });
});
