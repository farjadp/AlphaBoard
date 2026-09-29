import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { TradingLimitsInput } from "@/lib/db/inputs";
import { dailyUsage, setLimits } from "@/lib/sessions/limits";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, user) => NextResponse.json(await dailyUsage(user.id)));

/** Account-wide daily limits across all sessions (null = no limit). */
export const PUT = userRoute(async (req, user) => NextResponse.json(await setLimits(user.id, TradingLimitsInput.parse(await readJson(req, 500)))));
