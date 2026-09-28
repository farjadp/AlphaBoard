import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/http/route";
import { readJson } from "@/lib/http/errors";
import { requireAdmin } from "@/lib/auth/dal";
import { generateInviteToken, hashInviteToken, inviteExpiry, inviteState, inviteUrl } from "@/lib/auth/invites";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const invites = await prisma.invite.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { createdBy: { select: { email: true } }, usedBy: { select: { email: true } } },
  });
  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      state: inviteState(i),
      expiresAt: i.expiresAt,
      usedAt: i.usedAt,
      usedBy: i.usedBy?.email ?? null,
      createdBy: i.createdBy.email,
      createdAt: i.createdAt,
    })),
  });
});

const createSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()).optional(),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
  days: z.number().int().min(1).max(90).optional(),
});

/** Creates an invite. The raw token is returned ONCE here and never stored. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const data = createSchema.parse(await readJson(req, 5_000));

  const token = generateInviteToken();
  const invite = await prisma.invite.create({
    data: {
      tokenHash: hashInviteToken(token),
      email: data.email,
      role: data.role,
      createdById: admin.id,
      expiresAt: inviteExpiry(new Date(), data.days),
    },
  });
  await prisma.auditLog.create({
    data: { userId: admin.id, action: "admin.invite_created", target: data.email ?? invite.id, meta: { role: data.role } },
  });

  return NextResponse.json({ id: invite.id, url: inviteUrl(token), expiresAt: invite.expiresAt }, { status: 201 });
});
