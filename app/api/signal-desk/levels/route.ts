import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { badRequest, readJson } from "@/lib/http/errors";
import { findAsset } from "@/lib/market/catalog";
import { getCandles } from "@/lib/market/candles";
import { catalogSymbolFor, suggestLevels } from "@/lib/signalDesk/levels";

export const dynamic = "force-dynamic";

const Body = z.object({ symbol: z.string().trim().min(1).max(32), side: z.enum(["BUY", "SELL"]), entry: z.number().positive().nullable().default(null) });

/** Stop and Fibonacci targets from live 1H candles for a symbol + side (see lib/signals/levels.ts). */
export const POST = adminRoute(async (req, _admin) => {
  const { symbol, side, entry } = Body.parse(await readJson(req, 10_000));
  const catalog = catalogSymbolFor(symbol);
  const asset = catalog ? findAsset(catalog) : undefined;
  if (!asset) throw badRequest(`No market data for ${symbol}; enter the stop and targets by hand`);
  let levels;
  try {
    levels = suggestLevels(await getCandles(asset, "1H"), side, entry);
  } catch (e) {
    throw badRequest(`Could not read ${asset.symbol} candles: ${e instanceof Error ? e.message : String(e)}`);
  }
  const notes = [`From ${asset.symbol} 1H candles (last price ${levels.price})`, ...levels.notes];
  if (entry == null && asset.yahooSymbol?.endsWith("=F")) {
    notes.push(`${asset.symbol} data is a futures contract, which trades a little away from your broker's spot price: type your broker's price in Entry and suggest again for exact levels`);
  }
  return NextResponse.json({ stop: levels.stop, tps: levels.tps, notes });
});
