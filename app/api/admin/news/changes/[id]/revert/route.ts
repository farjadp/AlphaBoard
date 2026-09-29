import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { revertWeightChange } from "@/lib/news/weights";

/** Undo the latest weight change of a publisher. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { id } = await params;
  await revertWeightChange(id, admin.id);
  await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.news_weight_revert", target: id } });
  return NextResponse.json({ ok: true });
});
