import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { HttpError } from "@/lib/http/errors";
import { logger } from "@/lib/http/logger";
import { requireAsset, requireTimeframe } from "@/lib/market/assets";
import { getCandles } from "@/lib/market/candles";

export const dynamic = "force-dynamic";

/** OHLC bars for the price chart (same cached source the indicators are computed from). */
export const GET = route(async (req) => {
  await requireUser();
  enforceRateLimit(req, "api");
  const q = new URL(req.url).searchParams;
  const asset = requireAsset(q.get("symbol"));
  const timeframe = requireTimeframe(q.get("timeframe"), "1H");
  try {
    const candles = await getCandles(asset, timeframe);
    return NextResponse.json({
      symbol: asset.symbol,
      timeframe,
      candles: candles
        .filter((c): c is typeof c & { time: number } => typeof c.time === "number")
        .map((c) => ({ time: Math.floor(c.time / 1000), open: c.open, high: c.high, low: c.low, close: c.close })),
    });
  } catch (e) {
    logger.warn({ symbol: asset.symbol, timeframe, err: e instanceof Error ? e.message : String(e) }, "candles unavailable");
    throw new HttpError(503, "Price history is unavailable right now", "MARKET_DATA_UNAVAILABLE");
  }
});
