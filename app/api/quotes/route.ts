import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { findAsset } from "@/lib/assetCatalog";
import { getQuote } from "@/lib/market/quote";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 60;

/** Batch quotes for Yahoo-sourced assets (crypto streams over the Binance websocket client-side). */
export const GET = route(async (req) => {
  await requireUser();
  enforceRateLimit(req, "api");
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_SYMBOLS);

  const assets = symbols.map(findAsset).filter((a) => a?.yahooSymbol);
  const out: Record<string, { price: number; change: number; high: number; low: number; volume: number }> = {};
  await Promise.all(assets.map(async (a) => {
    const q = await getQuote(a!);
    if (q) out[a!.symbol] = { price: q.price, change: q.changePct ?? 0, high: q.high ?? 0, low: q.low ?? 0, volume: q.volume ?? 0 };
  }));
  return NextResponse.json(out);
});
