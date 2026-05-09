export interface BinanceTicker {
  symbol: string;   // "BTCUSDT"
  price: number;
  change: number;   // 24h change %
  high: number;
  low: number;
  volume: number;   // quote volume in USDT
}

/** "BTC/USDT" → "BTCUSDT" */
export function pairToSymbol(pair: string): string {
  return pair.replace("/", "").toUpperCase();
}

/** "BTCUSDT" → "BTC/USDT" */
export function symbolToPair(symbol: string): string {
  if (symbol.endsWith("USDT")) return symbol.slice(0, -4) + "/USDT";
  return symbol;
}

export function formatPrice(n: number): string {
  if (n >= 1000)
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "$" + n.toFixed(6);
}

export function formatVolume(usd: number): string {
  if (usd >= 1e12) return "$" + (usd / 1e12).toFixed(1) + "T";
  if (usd >= 1e9) return "$" + (usd / 1e9).toFixed(1) + "B";
  if (usd >= 1e6) return "$" + (usd / 1e6).toFixed(1) + "M";
  return "$" + usd.toFixed(0);
}

export function formatMarketCap(n: number): string {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  return "$" + n.toFixed(0);
}

export function formatSupply(n: number, symbol?: string): string {
  let val = "";
  if (n >= 1e9) val = (n / 1e9).toFixed(1) + "B";
  else if (n >= 1e6) val = (n / 1e6).toFixed(1) + "M";
  else val = n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  
  if (symbol) {
    const base = symbol.split("/")[0];
    return `${val} ${base}`;
  }
  return val;
}
