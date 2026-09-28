/** "4 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "recently";
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** Decimal places that keep a price readable at its magnitude. */
export function pricePrecision(price: number | null | undefined): number {
  if (!price || !Number.isFinite(price)) return 2;
  if (price >= 1) return 2;
  if (price >= 0.01) return 4;
  return 8;
}

export function signedPct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}
