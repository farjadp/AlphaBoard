import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { notFound } from "@/lib/http/errors";
import { sessionReport } from "@/lib/sessions/service";

export const dynamic = "force-dynamic";

export const GET = userIdRoute(async (_req, user, id) => {
  const dto = await sessionReport(user.id, id);
  if (!dto) throw notFound("No report yet");
  return NextResponse.json(dto);
});
