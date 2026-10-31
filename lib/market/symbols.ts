/**
 * Symbol spellings. Brokers glue suffixes on ("XAUUSD.ec", "XAUUSDm"), channels write aliases ("GOLD",
 * "ETHUSDT.P", "BTCUSDT PERP") and the catalog uses "XAU/USD". These helpers are the one place that
 * knows how to get from any of those to a bare upper-case ticker and back to a known symbol. Pure.
 */

const ALIASES: Record<string, string> = { GOLD: "XAUUSD", SILVER: "XAGUSD" };

/** Drop a broker suffix only: "XAUUSD.ec" / "XAUUSDm" → "XAUUSD". Case of the body is kept. */
export function stripBrokerSuffix(symbol: string): string {
  return symbol.split(".")[0].replace(/[a-z]+$/, "");
}

/** Broker symbol → bare upper-case ticker ("xauusd.ec" → "XAUUSD"). */
export function brokerTicker(symbol: string): string {
  return stripBrokerSuffix(symbol).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Anything a human wrote → bare upper-case ticker, aliases resolved:
 * "XAU/USD", "GOLD", "ETHUSDT.P", "BTCUSDT PERP", "XAUUSDm" → "XAUUSD" / "ETHUSDT" / "BTCUSDT". "" when nothing usable.
 */
export function canonicalTicker(raw: string): string {
  const s = raw.trim()
    .replace(/(?<=[A-Z0-9])[a-z]{1,3}$/, "") // broker suffix glued on: XAUUSDm
    .toUpperCase()
    .replace(/\.P$|PERP(ETUAL)?$/g, "")
    .replace(/\.[A-Z0-9]{1,5}$/, "") // broker suffix after a dot: XAUUSD.ec
    .replace(/[^A-Z0-9]/g, "");
  return ALIASES[s] ?? s;
}

/** USD and USDT count as the same quote; a bare coin ("OP") may be quoted in either. */
export function quoteVariants(ticker: string): string[] {
  return [...new Set([ticker, ticker.replace(/USDT$/, "USD"), ticker.replace(/USD$/, "USDT"), `${ticker}USD`, `${ticker}USDT`])];
}

/** The first of `symbols` (broker spellings) that means the same instrument as `raw`, or null. */
export function matchBrokerSymbol(raw: string, symbols: string[]): string | null {
  const want = canonicalTicker(raw);
  if (!want) return null;
  const variants = new Set(quoteVariants(want));
  return symbols.find((s) => variants.has(brokerTicker(s))) ?? null;
}

/** The first catalog symbol ("XAU/USD", "OP/USDT") that means the same instrument as `raw`, or null. */
export function matchCatalogSymbol(raw: string, catalog: ReadonlyArray<{ symbol: string }>): string | null {
  const want = canonicalTicker(raw);
  if (!want) return null;
  for (const v of quoteVariants(want)) {
    const hit = catalog.find((a) => a.symbol.replace("/", "").toUpperCase() === v);
    if (hit) return hit.symbol;
  }
  return null;
}
