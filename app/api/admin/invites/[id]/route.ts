import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { prisma } from "@/lib/db/client";

/** Revoke an unused invite. */
export const DELETE = adminRoute(async (_req, admin, { params }) => {
  const { id } = await params;
  const res = await prisma.invite.deleteMany({ where: { id, usedAt: null } });
  if (res.count === 1) {
    await audit(admin.id, "admin.invite_revoked", { target: id });
  }
  return NextResponse.json({ revoked: res.count === 1 });
});
