/** Display helpers for paper-trading values (USDT). null → "Unavailable", never 0. Thin aliases over lib/format. */
import { amount, pctOrNa, price as fmtPrice, qty as fmtQty, when as fmtWhen } from "@/lib/format";

export const money = amount;
export const pct = pctOrNa;
export const price = fmtPrice;
export const qty = fmtQty;
export const when = fmtWhen;

export const tone = (n: number | null | undefined) =>
  n == null || n === 0 ? "text-ink-2" : n > 0 ? "text-up" : "text-down";
