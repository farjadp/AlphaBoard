/**
 * Strategy Lab — price bars and the facts every simulator needs (pure). Times are epoch ms (UTC).
 */
export interface Bars {
  t: Float64Array;
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
}

export function makeBars(rows: ArrayLike<readonly [number, number, number, number, number]>): Bars {
  const n = rows.length;
  const b: Bars = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    b.t[i] = r[0]; b.o[i] = r[1]; b.h[i] = r[2]; b.l[i] = r[3]; b.c[i] = r[4];
  }
  return b;
}

/** Index of the first bar of every `minutes` bucket (buckets aligned to UTC). */
export function bucketStarts(b: Bars, minutes: number): Int32Array {
  const ms = minutes * 60_000;
  const out: number[] = [];
  let prev = Number.NaN;
  for (let i = 0; i < b.t.length; i++) {
    const k = Math.floor(b.t[i] / ms);
    if (k !== prev) { out.push(i); prev = k; }
  }
  return Int32Array.from(out);
}

/** Median high−low of the `minutes` buckets (optionally only the last `lastN`). The "1 candle" unit. */
export function medianRange(b: Bars, minutes: number, lastN?: number): number {
  const starts = bucketStarts(b, minutes);
  const ranges: number[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : b.t.length;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = from; i < to; i++) { if (b.h[i] > hi) hi = b.h[i]; if (b.l[i] < lo) lo = b.l[i]; }
    ranges.push(hi - lo);
  }
  const r = lastN ? ranges.slice(-lastN) : ranges;
  if (!r.length) return Number.NaN;
  r.sort((a, c) => a - c);
  const m = r.length >> 1;
  return r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2;
}

const H4 = 4 * 3_600_000;

/**
 * H4 trend per bar: sign(EMA50 − EMA200) of the closes of completed 4-hour blocks, taken from the block
 * before the bar's own (no look-ahead). 0 until 200 blocks exist.
 */
export function trendH4(b: Bars): Int8Array {
  const n = b.t.length;
  const blockOf = new Int32Array(n);
  const closes: number[] = [];
  let prev = Number.NaN;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(b.t[i] / H4);
    if (k !== prev) { closes.push(b.c[i]); prev = k; } else closes[closes.length - 1] = b.c[i];
    blockOf[i] = closes.length - 1;
  }
  const sign = new Int8Array(closes.length);
  let e50 = closes[0];
  let e200 = closes[0];
  const k50 = 2 / 51;
  const k200 = 2 / 201;
  for (let k = 0; k < closes.length; k++) {
    if (k > 0) { e50 += k50 * (closes[k] - e50); e200 += k200 * (closes[k] - e200); }
    sign[k] = k < 200 ? 0 : e50 > e200 ? 1 : e50 < e200 ? -1 : 0;
  }
  const out = new Int8Array(n);
  for (let i = 0; i < n; i++) out[i] = blockOf[i] >= 1 ? sign[blockOf[i] - 1] : 0;
  return out;
}

/**
 * For each bar, the index of the last bar before the next data hole (or the last bar). A hole is a gap
 * over 52 h, or over 4 h that does not start on a Friday (the weekly FX/metals close is not a hole).
 */
export function holeAfter(b: Bars): Int32Array {
  const n = b.t.length;
  const out = new Int32Array(n);
  let next = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    if (i < n - 1) {
      const gap = b.t[i + 1] - b.t[i];
      const friday = new Date(b.t[i]).getUTCDay() === 5;
      if (gap > 52 * 3_600_000 || (gap > 4 * 3_600_000 && !friday)) next = i;
    }
    out[i] = next;
  }
  return out;
}
