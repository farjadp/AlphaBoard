import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/auth/dal";
import { notFound, readJson } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";

const Body = z.object({ dailyTokenQuota: z.number().int().min(0).max(50_000_000) });

/** Adjust a user's daily AI token allowance (0 disables AI for that user). */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  const { dailyTokenQuota } = Body.parse(await readJson(req, 500));
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound("User not found");
  const user = await prisma.user.update({ where: { id }, data: { dailyTokenQuota }, select: { id: true, email: true, dailyTokenQuota: true } });
  await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.user_quota", target: user.email, meta: { dailyTokenQuota } } });
  return NextResponse.json({ user });
});
