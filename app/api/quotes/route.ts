import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { ASSET_CATALOG } from "@/lib/assetCatalog";

export const dynamic = "force-dynamic";

const yf = new YahooFinance();

// Build a fast lookup: pairSymbol → yahooSymbol
const YAHOO_MAP: Record<string, string> = {};
for (const a of ASSET_CATALOG) {
  if (a.yahooSymbol) YAHOO_MAP[a.symbol] = a.yahooSymbol;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("symbols") ?? "";

  // If specific symbols requested, filter to those. Otherwise fetch all tradfi.
  const requested = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && YAHOO_MAP[s]);

  const targets = requested.length > 0 ? requested : Object.keys(YAHOO_MAP);

  const results: Record<
    string,
    { price: number; change: number; high: number; low: number; volume: number }
  > = {};

  await Promise.all(
    targets.map(async (pairSymbol) => {
      const yahooSym = YAHOO_MAP[pairSymbol];
      try {
        const quote: any = await yf.quote(yahooSym);
        if (quote?.regularMarketPrice) {
          results[pairSymbol] = {
            price:  quote.regularMarketPrice,
            change: quote.regularMarketChangePercent ?? 0,
            high:   quote.regularMarketDayHigh ?? 0,
            low:    quote.regularMarketDayLow ?? 0,
            volume: quote.regularMarketVolume ?? 0,
          };
        }
      } catch (err: any) {
        console.error(`[quotes] ${pairSymbol} (${yahooSym}):`, err?.message);
      }
    })
  );

  return NextResponse.json(results);
}
