import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { PaperExitsInput } from "@/lib/db/inputs";
import { paperOverview, updatePositionExits } from "@/lib/paper/account";

export const dynamic = "force-dynamic";

/** Move stop-loss / take-profit (null removes one). */
export const PATCH = userIdRoute(async (req, user, id) => {
  await updatePositionExits(user.id, id, PaperExitsInput.parse(await readJson(req, 1_000)));
  return NextResponse.json(await paperOverview(user.id));
});
