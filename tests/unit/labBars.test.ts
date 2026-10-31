import { describe, it, expect } from "vitest";
import { bucketStarts, holeAfter, makeBars, medianRange, noHoles, trendH4 } from "@/lib/lab/bars";

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.UTC(2026, 9, 19, 12, 7); // Monday 12:07 UTC

/** Flat minute bars with the given closes, one per minute from `start`. */
const minutes = (closes: number[], start = T0) =>
  makeBars(closes.map((c, i) => [start + i * MIN, c, c, c, c] as const));

describe("lab bars", () => {
  it("keeps rows in order as typed arrays", () => {
    const b = makeBars([[1, 2, 3, 0.5, 2.5], [2, 2.5, 4, 2, 3]]);
    expect(Array.from(b.t)).toEqual([1, 2]);
    expect(Array.from(b.h)).toEqual([3, 4]);
    expect(b.c[1]).toBe(3);
  });

  it("finds the first bar of every 15-minute bucket", () => {
    const b = minutes(Array.from({ length: 30 }, () => 1)); // 12:07 … 12:36
    // buckets start at 12:07 (index 0), 12:15 (8), 12:30 (23)
    expect(Array.from(bucketStarts(b, 15))).toEqual([0, 8, 23]);
  });

  it("median 15-minute range", () => {
    const t = Date.UTC(2026, 9, 19, 12, 0);
    const rows: Array<[number, number, number, number, number]> = [];
    const ranges = [2, 4, 9];
    ranges.forEach((r, k) => {
      for (let m = 0; m < 15; m++) rows.push([t + (k * 15 + m) * MIN, 100, m === 3 ? 100 + r : 100, 100, 100]);
    });
    expect(medianRange(makeBars(rows), 15)).toBe(4);
    expect(medianRange(makeBars(rows), 15, 1)).toBe(9);
  });

  it("H4 trend is 0 until 200 completed blocks, then follows EMA50 vs EMA200 of completed blocks only", () => {
    const blocks = 260;
    const rows: Array<[number, number, number, number, number]> = [];
    const t = Date.UTC(2026, 0, 5); // aligned to 4h
    for (let k = 0; k < blocks; k++) {
      const px = k < 230 ? 100 + k : 100 + 230 - (k - 230) * 40; // rise, then a hard fall
      rows.push([t + k * 4 * H, px, px, px, px], [t + k * 4 * H + 2 * H, px, px, px, px]);
    }
    const b = makeBars(rows);
    const tr = trendH4(b);
    expect(tr[2 * 150]).toBe(0);
    expect(tr[2 * 220]).toBe(1);
    // block 255 is deep in the fall: by then EMA50 is below EMA200
    expect(tr[2 * 259]).toBe(-1);
    // a bar inside block k uses block k−1's sign: both bars of a block agree
    expect(tr[2 * 240]).toBe(tr[2 * 240 + 1]);
  });

  it("data holes: a 5 h weekday gap counts, a Friday-to-Sunday gap does not", () => {
    const fri = Date.UTC(2026, 9, 23, 20, 58); // Friday
    const b = makeBars([
      [T0, 1, 1, 1, 1], [T0 + MIN, 1, 1, 1, 1], [T0 + MIN + 5 * H, 1, 1, 1, 1], // Monday 5 h gap after index 1
      [fri, 1, 1, 1, 1], [fri + 49 * H, 1, 1, 1, 1], [fri + 49 * H + MIN, 1, 1, 1, 1],
    ]);
    const holes = holeAfter(b);
    expect(holes[0]).toBe(1);
    expect(holes[1]).toBe(1);
    // the gap between index 2 and 3 is days long (> 52 h) → a hole after index 2
    expect(holes[2]).toBe(2);
    // the weekend gap after index 3 is not a hole; nothing after → last index
    expect(holes[3]).toBe(5);
  });

  it("noHoles: every bar may run to the end of the data", () => {
    const b = makeBars([[0, 1, 1, 1, 1], [10 * 3_600_000, 1, 1, 1, 1], [11 * 3_600_000, 1, 1, 1, 1]]);
    expect(Array.from(noHoles(b))).toEqual([2, 2, 2]);
  });
});
