/** Server-side price-alert check (pure): did a candle's high/low cross the level since the last check? */
export interface AlertLevel { condition: "above" | "below"; targetPrice: number }
export interface AlertBar { time: number; open: number; high: number; low: number }

/**
 * Earliest crossing among bars that started at or after `fromTime` (earlier bars may predate the alert).
 * The reported price is the level, or the open when price gapped straight through it.
 */
export function alertHit(a: AlertLevel, bars: AlertBar[], fromTime: number): { at: number; price: number } | null {
  for (const b of [...bars].filter((x) => x.time >= fromTime).sort((x, y) => x.time - y.time)) {
    if (a.condition === "above" && b.high >= a.targetPrice) return { at: b.time, price: b.open > a.targetPrice ? b.open : a.targetPrice };
    if (a.condition === "below" && b.low <= a.targetPrice) return { at: b.time, price: b.open < a.targetPrice ? b.open : a.targetPrice };
  }
  return null;
}
