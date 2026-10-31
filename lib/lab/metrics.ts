/** Strategy Lab — summary numbers (pure). Values that cannot be computed are null, never a made-up 0. */

/** Largest fall from a running peak, in percent of that peak. */
export function maxDrawdownPct(equity: ArrayLike<number>): number {
  let peak = -Infinity;
  let dd = 0;
  for (let i = 0; i < equity.length; i++) {
    const e = equity[i];
    if (e > peak) peak = e;
    else if (peak > 0) dd = Math.max(dd, (peak - e) / peak);
  }
  return dd * 100;
}

/** Calendar-year returns (UTC) from a [time ms, balance] curve that starts at `start`. */
export function perYearPct(curve: Array<[number, number]>, start: number): Record<string, number> {
  const out: Record<string, number> = {};
  let base = start;
  let year: number | null = null;
  let lastBal = start;
  for (const [t, bal] of curve) {
    const y = new Date(t).getUTCFullYear();
    if (year != null && y !== year) {
      out[String(year)] = round1(((lastBal / base) - 1) * 100);
      base = lastBal;
    }
    year = y;
    lastBal = bal;
  }
  if (year != null) out[String(year)] = round1(((lastBal / base) - 1) * 100);
  return out;
}

/** Sum of wins over the sum of losses; null without both. */
export function profitFactor(pnls: number[]): number | null {
  let w = 0;
  let l = 0;
  for (const p of pnls) { if (p > 0) w += p; else if (p < 0) l -= p; }
  return w > 0 && l > 0 ? w / l : null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
