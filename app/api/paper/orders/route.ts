import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { PaperOrderInput } from "@/lib/db/inputs";
import { openPaperPosition, paperOverview } from "@/lib/paper/account";

export const dynamic = "force-dynamic";

/** Market order that opens a position at the live quote (slippage + fee applied server-side). */
export const POST = userRoute(async (req, user) => {
  const position = await openPaperPosition(user.id, PaperOrderInput.parse(await readJson(req, 2_000)));
  return NextResponse.json({ positionId: position.id, overview: await paperOverview(user.id) }, { status: 201 });
});
