import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { SessionPositionInput } from "@/lib/db/inputs";
import { closeSessionPosition, moveStopToBreakeven, sessionView, setSessionExits } from "@/lib/sessions/service";

export const dynamic = "force-dynamic";

/** Manage an open session position: close (any fraction), close half, move the stop to breakeven, or set stop / target. */
export const POST = userIdRoute(async (req, user, id) => {
  const input = SessionPositionInput.parse(await readJson(req, 500));
  if (input.action === "breakeven") await moveStopToBreakeven(user.id, id);
  else if (input.action === "set_exits") await setSessionExits(user.id, id, { stopLoss: input.stopLoss, takeProfit: input.takeProfit });
  else await closeSessionPosition(user.id, id, input.action === "close_half" ? 0.5 : input.fraction ?? 1);
  const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id }, select: { sessionId: true } });
  return NextResponse.json(await sessionView(user.id, pos.sessionId));
});
