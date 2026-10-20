import { describe, it, expect } from "vitest";
import { halfSubset, mulberry32, spread } from "@/lib/lab/robust";

describe("lab robustness helpers", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(1), b = mulberry32(1);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(2)()).not.toBe(xs[0]);
  });
  it("halfSubset keeps order, is about half, and repeats for the same seed", () => {
    const all = Array.from({ length: 10_000 }, (_, i) => i * 3);
    const s = halfSubset(all, 7);
    expect(s.length).toBeGreaterThan(4_800);
    expect(s.length).toBeLessThan(5_200);
    expect(Array.from(s)).toEqual(Array.from(halfSubset(all, 7)));
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
  });
  it("spread summarises a distribution", () => {
    expect(spread([-1, 2, 3])).toEqual({ median: 2, min: -1, max: 3, positiveShare: 2 / 3 });
    expect(spread([1, 2, 3, 4]).median).toBe(2.5);
  });
});
