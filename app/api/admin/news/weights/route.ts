import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { prisma } from "@/lib/prisma";
import { runWeightAgent } from "@/lib/news/weights";

export const dynamic = "force-dynamic";

/** Run the weekly news-weights agent now (it still refuses publishers with too few evaluated calls). */
export const POST = adminRoute(async (_req, admin) => {
  const runId = await runWeightAgent({ force: true });
  await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.news_weights_run", target: runId ?? undefined } });
  return NextResponse.json({ runId });
});
