import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/auth/dal";

/** Revoke an unused invite. */
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const res = await prisma.invite.deleteMany({ where: { id, usedAt: null } });
  if (res.count === 1) {
    await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.invite_revoked", target: id } });
  }
  return NextResponse.json({ revoked: res.count === 1 });
});
