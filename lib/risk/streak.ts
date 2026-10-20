/** Losing-streak facts for the money-management guards (pure). */
export interface ClosedResult {
  closedAt: number;
  /** Net result of the closed position (fees included); < 0 is a loss. */
  pnl: number;
}

const dayStart = (t: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/**
 * Trailing losses since 00:00 UTC of `now` (a result ≥ 0 resets the count), and the latest losing close
 * of any day — a cooldown that started before midnight still runs after it.
 */
export function lossStreak(closed: ClosedResult[], now: number): { streak: number; lastLossAt: number | null } {
  const sorted = [...closed].sort((a, b) => a.closedAt - b.closedAt);
  let lastLossAt: number | null = null;
  for (const c of sorted) if (c.pnl < 0) lastLossAt = c.closedAt;
  const since = dayStart(now);
  let streak = 0;
  for (const c of sorted) {
    if (c.closedAt < since) continue;
    streak = c.pnl < 0 ? streak + 1 : 0;
  }
  return { streak, lastLossAt };
}
