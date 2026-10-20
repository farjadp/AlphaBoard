/**
 * Mark-to-market drawdown (open positions included) — the number a realized-only curve hides: a book
 * that never closes its losers shows a smooth realized curve while its equity falls (P11 research).
 */
export function nextDrawdown(prev: { peak: number | null; maxDd: number }, equity: number) {
  const peak = prev.peak == null ? equity : Math.max(prev.peak, equity);
  const maxDd = Math.max(prev.maxDd, peak - equity);
  return { peak, maxDd, changed: peak !== prev.peak || maxDd !== prev.maxDd };
}
