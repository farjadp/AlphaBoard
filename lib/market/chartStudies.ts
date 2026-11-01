/** Exponential moving average seeded with the simple average of the first `period` values; null before that. Pure. */
export function ema(values: number[], period: number): (number | null)[] {
  if (period < 1) throw new Error("period must be at least 1");
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
