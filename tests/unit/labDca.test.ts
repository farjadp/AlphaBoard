import { describe, it, expect } from "vitest";
import { runDca, type Cube, type DcaParams } from "@/lib/lab/dca";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);
type Bar = [number, number, number, number] | null; // o h l c

const flat = (px: number, n: number): Bar[] => Array.from({ length: n }, () => [px, px, px, px]);

/** Symbols A, B and BTC (index 2); every series padded with its last price up to `n` hours unless null-terminated. */
function cube(a: Bar[], b: Bar[] = [], btc: Bar[] = [], n = 40): Cube {
  const col = (bars: Bar[], fill: number) => {
    const o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n);
    let last: Bar = [fill, fill, fill, fill];
    let ended = false;
    for (let k = 0; k < n; k++) {
      let x: Bar;
      if (k < bars.length) { x = bars[k]; if (x === null) ended = true; } else x = ended ? null : [last![3], last![3], last![3], last![3]];
      if (x) last = x;
      o[k] = x ? x[0] : Number.NaN; h[k] = x ? x[1] : Number.NaN; l[k] = x ? x[2] : Number.NaN; c[k] = x ? x[3] : Number.NaN;
    }
    return { o, h, l, c };
  };
  const cols = [col(a, 100), col(b, 100), col(btc, 100)];
  return {
    t: Float64Array.from({ length: n }, (_, k) => T0 + k * HOUR), syms: ["A", "B", "BTC"],
    o: cols.map((x) => x.o), h: cols.map((x) => x.h), l: cols.map((x) => x.l), c: cols.map((x) => x.c),
  };
}

const P = (o: Partial<DcaParams> = {}): DcaParams => ({
  slots: 2, deepSlots: 1, drop: 0.03, d1: 0.09, d2: 0.195, sizes: [1, 1.8, 4.7], tp0: 0.015, tp1: 0.01, fee: 0,
  btcLock: 0.05, btcIndex: 2, stopLoss: null, ...o,
});
const U = 1000 / 2 / 7.5; // first buy of a deep slot: half the wallet spread over the 1 + 1.8 + 4.7 ladder

/** A dips 3.5 % at hour 30 → bought at hour 31's open (96.5). */
const dip: Bar[] = [...flat(100, 30), [100, 100, 96, 96.5]];

describe("lab DCA ladder", () => {
  it("buys after a 3 % drop from the 24 h high and sells at +1.5 %", () => {
    const r = runDca(cube([...dip, [96.5, 97, 96.4, 96.8], [96.8, 98, 96.8, 97.5]]), P(), T0);
    expect(r.episodes).toBe(1);
    expect(r.depthShare).toEqual([1, 0, 0]);
    expect(r.finalBalance).toBeCloseTo(1000 + U * 0.015, 9);
  });

  it("adds at −9 % and −19.5 %, then takes +1 % over the new average", () => {
    const path: Bar[] = [...dip, [96.5, 96.5, 87.8, 88], [88, 88, 77.6, 78], [78, 90, 78, 89]];
    const r = runDca(cube(path), P(), T0);
    expect(r.depthShare).toEqual([0, 0, 1]);
    const q = U / 96.5 + (1.8 * U) / (96.5 * 0.91) + (4.7 * U) / (96.5 * 0.805);
    const avg = (7.5 * U) / q;
    expect(r.finalBalance).toBeCloseTo(1000 + q * avg * 1.01 - 7.5 * U, 6);
    // the open position fell a long way before it closed in profit; the realized curve never saw it
    expect(r.maxDdRealizedPct).toBe(0);
    // at hour 32 the 500-dollar position is ~5 % under its average → ~2.5 % of the account
    expect(r.maxDdMtmPct).toBeGreaterThan(2);
  });

  it("a shallow slot never takes the second add", () => {
    const path: Bar[] = [...dip, [96.5, 96.5, 87.8, 88], [88, 88, 77.6, 78], [78, 90, 78, 89], [89, 92, 89, 91]];
    const r = runDca(cube(path), P({ deepSlots: 0 }), T0);
    expect(r.depthShare).toEqual([0, 1, 0]);
  });

  it("no entries while BTC is down more than the lock over 24 h", () => {
    const btc: Bar[] = [...flat(100, 30), [100, 100, 93, 94]];
    const r = runDca(cube(dip, [], btc), P(), T0);
    expect(r.episodes).toBe(0);
    expect(r.avgSlots).toBe(0);
  });

  it("sells a symbol at its last price when its data ends (delisted)", () => {
    const path: Bar[] = [...dip, [96.5, 96.5, 96, 96.2], [96.2, 91, 89, 90], null];
    const r = runDca(cube(path), P(), T0);
    expect(r.episodes).toBe(1);
    expect(r.finalBalance).toBeCloseTo(1000 - U + (U * 90) / 96.5, 9);
  });

  it("an optional stop closes under the average", () => {
    const path: Bar[] = [...dip, [96.5, 96.5, 96, 96.2], [96.8, 96.8, 90, 91]];
    const r = runDca(cube(path), P({ stopLoss: 0.05 }), T0);
    expect(r.episodes).toBe(1);
    expect(r.finalBalance).toBeCloseTo(1000 - U * 0.05, 9);
  });

  it("never holds more positions than slots", () => {
    const both: Bar[] = dip;
    const r = runDca(cube(both, both, flat(100, 40)), P({ slots: 1 }), T0);
    expect(r.avgSlots).toBeLessThanOrEqual(1);
  });
});
