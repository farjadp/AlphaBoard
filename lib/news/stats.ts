/**
 * Pure measurement helpers: price at a time from 1H bars, and directional accuracy of sentiment.
 * A "call" is a sentiment outside the neutral band (|s| > 0.15); a hit is a call whose sign matches the
 * later return. Neutral articles are counted but never scored.
 */
export interface HourBar { time: number; open: number }
const HOUR = 3_600_000;

/** Open of the 1H bar that contains t (a price already known at t); null outside the bars' range. */
export function priceAt(bars: HourBar[], t: number): number | null {
  if (!bars.length || t < bars[0].time || t >= bars[bars.length - 1].time + HOUR) return null;
  let lo = 0, hi = bars.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].time <= t) lo = mid; else hi = mid - 1; }
  return bars[lo].open > 0 ? bars[lo].open : null;
}

export function returnsAfter(bars: HourBar[], t: number) {
  const p0 = priceAt(bars, t);
  const at = (h: number) => { const p = priceAt(bars, t + h * HOUR); return p0 && p ? p / p0 - 1 : null; };
  return { p0, ret4h: at(4), ret24h: at(24) };
}

export const isCall = (s: number) => Math.abs(s) > 0.15;

export interface Scored { sentiment: number; ret4h: number | null; ret24h: number | null }
export interface Accuracy { articles: number; calls: number; hitRate4h: number | null; hitRate24h: number | null; avgSignedRet24hPct: number | null }

export function accuracy(rows: Scored[]): Accuracy {
  const calls = rows.filter((r) => isCall(r.sentiment));
  const rate = (k: "ret4h" | "ret24h") => {
    const c = calls.filter((r) => r[k] != null && r[k] !== 0);
    return c.length ? c.filter((r) => Math.sign(r.sentiment) === Math.sign(r[k]!)).length / c.length : null;
  };
  const signed = calls.filter((r) => r.ret24h != null).map((r) => Math.sign(r.sentiment) * r.ret24h! * 100);
  return {
    articles: rows.length, calls: calls.length, hitRate4h: rate("ret4h"), hitRate24h: rate("ret24h"),
    avgSignedRet24hPct: signed.length ? signed.reduce((a, b) => a + b, 0) / signed.length : null,
  };
}

/** Pearson correlation; null under 3 pairs or with no variance. */
export function correlation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
