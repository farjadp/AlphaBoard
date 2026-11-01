import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { readJson } from "@/lib/http/errors";
import { inviteState } from "@/lib/auth/invites";
import { createInvite, listInvites } from "@/lib/auth/inviteStore";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_req, _admin) => {
  const invites = await listInvites();
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
export const POST = adminRoute(async (req, admin) => {
  const data = createSchema.parse(await readJson(req, 5_000));

  const invite = await createInvite(admin.id, data);

  return NextResponse.json(invite, { status: 201 });
});
