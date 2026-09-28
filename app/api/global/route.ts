import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { getGlobalMarket } from "@/lib/market/fundamentals";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireUser();
  enforceRateLimit(req, "api");
  return NextResponse.json({ global: await getGlobalMarket() });
});
