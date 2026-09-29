/** Display helpers for paper-trading values (USDT). null → "Unavailable", never 0. */
export const money = (n: number | null | undefined, signed = false) => {
  if (n == null || !Number.isFinite(n)) return "Unavailable";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${signed ? (n > 0 ? "+" : n < 0 ? "−" : "") : n < 0 ? "−" : ""}${s}`;
};

export const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "Unavailable" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;

/** Prices keep precision proportional to magnitude (BTC vs EUR/USD). */
export const price = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const digits = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 6 });

export const tone = (n: number | null | undefined) =>
  n == null || n === 0 ? "text-ink-2" : n > 0 ? "text-up" : "text-down";

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
