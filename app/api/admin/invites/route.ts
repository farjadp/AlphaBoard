import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/http/route";
import { readJson } from "@/lib/http/errors";
import { requireAdmin } from "@/lib/auth/dal";
import { inviteState } from "@/lib/auth/invites";
import { createInvite } from "@/lib/auth/createInvite";

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

  const invite = await createInvite(admin.id, data);

  return NextResponse.json(invite, { status: 201 });
});
