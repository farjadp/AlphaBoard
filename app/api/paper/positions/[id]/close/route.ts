import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { closePaperPosition, paperOverview } from "@/lib/paper/account";

export const dynamic = "force-dynamic";

/** Close at market (live quote, slippage + fee). */
export const POST = userIdRoute(async (_req, user, id) => {
  await closePaperPosition(user.id, id);
  return NextResponse.json(await paperOverview(user.id));
});
