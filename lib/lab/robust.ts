/** Strategy Lab — seeded randomness and distribution summaries for robustness runs (pure). */

/** Small, fast, seedable PRNG (Mulberry32): the same seed always gives the same run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random half of the entries (each kept with probability ½), in the original order. */
export function halfSubset(entries: ArrayLike<number>, seed: number): Int32Array {
  const r = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < entries.length; i++) if (r() < 0.5) out.push(entries[i]);
  return Int32Array.from(out);
}

export interface Spread { median: number; min: number; max: number; positiveShare: number }

export function spread(values: number[]): Spread {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return {
    median: v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2,
    min: v[0],
    max: v[v.length - 1],
    positiveShare: v.filter((x) => x > 0).length / v.length,
  };
}
