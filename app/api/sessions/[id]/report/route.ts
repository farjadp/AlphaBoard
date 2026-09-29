import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { notFound } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import type { SessionMetrics, SessionReportDto } from "@/lib/types/sessions";

export const dynamic = "force-dynamic";

export const GET = userIdRoute(async (_req, user, id) => {
  const r = await prisma.sessionReport.findFirst({ where: { sessionId: id, session: { userId: user.id } } });
  if (!r) throw notFound("No report yet");
  const dto: SessionReportDto = {
    summary: r.summary, lessons: Array.isArray(r.lessons) ? (r.lessons as string[]) : [],
    metrics: r.metrics as unknown as SessionMetrics, createdAt: r.createdAt.toISOString(),
  };
  return NextResponse.json(dto);
});
