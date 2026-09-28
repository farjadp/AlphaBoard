import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAsset } from "@/lib/market/assets";
import { getBalanceSheet } from "@/lib/market/fundamentals";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await requireUser();
  enforceRateLimit(req, "api");
  const asset = requireAsset(new URL(req.url).searchParams.get("symbol"));
  return NextResponse.json({ balanceSheet: await getBalanceSheet(asset) });
});
