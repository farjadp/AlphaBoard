import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { SessionPositionInput } from "@/lib/db/inputs";
import { closeSessionPosition, moveStopToBreakeven, sessionView } from "@/lib/sessions/service";

export const dynamic = "force-dynamic";

/** Manage an open session position: close, close half, or move the stop to breakeven. */
export const POST = userIdRoute(async (req, user, id) => {
  const { action } = SessionPositionInput.parse(await readJson(req, 500));
  if (action === "breakeven") await moveStopToBreakeven(user.id, id);
  else await closeSessionPosition(user.id, id, action === "close_half" ? 0.5 : 1);
  const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id }, select: { sessionId: true } });
  return NextResponse.json(await sessionView(user.id, pos.sessionId));
});
