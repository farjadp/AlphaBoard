/** Money formatting. One sign convention everywhere: a true minus sign, "+" only when asked. Pure. */

const NA = "Unavailable";
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export interface MoneyOptions {
  /** Prefix such as "$" (default) or "" for a bare amount; a 3-letter code is appended as a suffix. */
  currency?: string;
  /** Show "+" for gains. */
  signed?: boolean;
  digits?: number;
  /** Text for null/NaN. Default "Unavailable" — never 0. */
  na?: string;
}

export function money(n: number | null | undefined, o: MoneyOptions = {}): string {
  if (!isNum(n)) return o.na ?? NA;
  const digits = o.digits ?? 2;
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const cur = o.currency ?? "$";
  const body = cur.length === 3 ? `${abs} ${cur}` : `${cur}${abs}`;
  const sign = n < 0 ? "−" : o.signed && n > 0 ? "+" : "";
  return `${sign}${body}`;
}

/** "$1,234.50" / "−$3.20"; `signed` adds "+" for gains. */
export const usd = (n: number | null | undefined, signed = false) => money(n, { signed });

/** Small AI costs: 4 decimals below $1, else 2. */
export const usdCost = (n: number) => money(n, { digits: n < 1 ? 4 : 2 });

/** Bare amount (no currency sign), as paper-trading tables show USDT. */
export const amount = (n: number | null | undefined, signed = false) => money(n, { currency: "", signed });

/** Market-data compact forms, moved from lib/binance.ts. */
export function formatPrice(n: number): string {
  if (n >= 1) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "$" + n.toFixed(6);
}

export function formatVolume(usdValue: number): string {
  if (usdValue >= 1e12) return "$" + (usdValue / 1e12).toFixed(1) + "T";
  if (usdValue >= 1e9) return "$" + (usdValue / 1e9).toFixed(1) + "B";
  if (usdValue >= 1e6) return "$" + (usdValue / 1e6).toFixed(1) + "M";
  if (usdValue >= 1e3) return "$" + (usdValue / 1e3).toFixed(1) + "K";
  return "$" + usdValue.toFixed(0);
}

export function formatMarketCap(n: number): string {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  return "$" + n.toFixed(0);
}

export function formatSupply(n: number, symbol?: string): string {
  const val = n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return symbol ? `${val} ${symbol.split("/")[0]}` : val;
}
