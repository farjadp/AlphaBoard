import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAsset, requireTimeframe } from "@/lib/market/assets";
import { getIndicatorReport } from "@/lib/market/report";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireUser();
  enforceRateLimit(req, "api");
  const q = new URL(req.url).searchParams;
  const asset = requireAsset(q.get("symbol"));
  const timeframe = requireTimeframe(q.get("timeframe"), "1H");
  return NextResponse.json(await getIndicatorReport(asset, timeframe));
});
