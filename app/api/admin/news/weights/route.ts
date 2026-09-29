import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { runWeightAgent } from "@/lib/news/weights";

export const dynamic = "force-dynamic";

/** Run the weekly news-weights agent now (it still refuses publishers with too few evaluated calls). */
export const POST = route(async () => {
  const admin = await requireAdmin();
  const runId = await runWeightAgent({ force: true });
  await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.news_weights_run", target: runId ?? undefined } });
  return NextResponse.json({ runId });
});
