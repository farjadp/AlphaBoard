import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { prisma } from "@/lib/prisma";

/** Revoke an unused invite. */
export const DELETE = adminRoute(async (_req, admin, { params }) => {
  const { id } = await params;
  const res = await prisma.invite.deleteMany({ where: { id, usedAt: null } });
  if (res.count === 1) {
    await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.invite_revoked", target: id } });
  }
  return NextResponse.json({ revoked: res.count === 1 });
});
