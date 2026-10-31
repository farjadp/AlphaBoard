/** Number formatting shared by server text (room reasons, reports, Telegram) and the UI. Pure. */

const NA = "Unavailable";
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** "+1.25%" / "−0.40%" (true minus sign). */
export function signedPct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

/** Signed percent with a zero sign only for non-zero values; null → "Unavailable". */
export function pctOrNa(n: number | null | undefined, digits = 2): string {
  if (!isNum(n)) return NA;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;
}

/** Decimal places that keep a price readable at its magnitude (BTC vs EUR/USD vs a 0.000x coin). */
export function pricePrecision(price: number | null | undefined): number {
  if (!price || !Number.isFinite(price)) return 2;
  if (price >= 1) return 2;
  if (price >= 0.01) return 4;
  return 8;
}

/** Digits for a price shown next to its own stop/target (finer than pricePrecision). */
export function priceDigits(n: number): number {
  const a = Math.abs(n);
  return a >= 1000 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
}

/** Price with magnitude-aware digits (no currency sign); null → "—". */
export function price(n: number | null | undefined, digits?: number): string {
  if (!isNum(n)) return "—";
  const d = digits ?? (n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 4 : 6);
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Price-aware number for prose (max digits only, so 1.1 stays "1.1"). */
export function fmtPrice(n: number, digits?: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits ?? priceDigits(n) });
}

/** Quantity: 2 decimals from 100 up, 6 below. */
export function qty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 6 });
}

/** R-multiple with sign and unit; null → "—". */
export function rText(n: number | null | undefined, signed = true): string {
  if (!isNum(n)) return "—";
  return `${signed && n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;
}
