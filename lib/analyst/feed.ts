import "server-only";
import { findAsset } from "@/lib/market/catalog";
import { getCandles } from "@/lib/market/candles";

/** Last 1H close per catalog symbol from our feed (null when unavailable); gold here is futures, not spot. */
export async function feedPrices(symbols: string[]): Promise<Record<string, number | null>> {
  const rows = await Promise.all(symbols.map(async (s) => {
    const asset = findAsset(s);
    if (!asset) return [s, null] as const;
    try {
      const bars = (await getCandles(asset, "1H")).filter((b) => b.close > 0);
      return [s, bars.at(-1)?.close ?? null] as const;
    } catch {
      return [s, null] as const;
    }
  }));
  return Object.fromEntries(rows);
}

/** Whether the feed for a symbol is a futures contract (its price differs from broker spot). */
export const isFuturesFeed = (symbol: string) => !!findAsset(symbol)?.yahooSymbol?.endsWith("=F");
