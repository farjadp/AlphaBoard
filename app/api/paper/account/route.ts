import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { PaperResetInput } from "@/lib/db/inputs";
import { paperOverview, resetPaperAccount } from "@/lib/paper/account";

export const dynamic = "force-dynamic";

/** Account, open positions (marked live), history, orders and the equity curve. */
export const GET = userRoute(async (_req, user) => NextResponse.json(await paperOverview(user.id)));

/** Reset: wipes positions/orders/curve and starts over with `startingBalance`. */
export const POST = userRoute(async (req, user) => {
  const { startingBalance } = PaperResetInput.parse(await readJson(req, 1_000));
  await resetPaperAccount(user.id, startingBalance);
  return NextResponse.json(await paperOverview(user.id));
});
