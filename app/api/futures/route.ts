import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAsset } from "@/lib/market/assets";
import { getFutures } from "@/lib/market/futures";

export const dynamic = "force-dynamic";

/** Funding, open interest and long/short ratio. `futures: null` = no perpetual market / providers down. */
export const GET = route(async (req) => {
  await requireUser();
  enforceRateLimit(req, "api");
  const asset = requireAsset(new URL(req.url).searchParams.get("symbol"));
  return NextResponse.json({ futures: await getFutures(asset) });
});
