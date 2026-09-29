import { describe, expect, it } from "vitest";
import { accuracy, correlation, priceAt, returnsAfter } from "@/lib/news/stats";

const H = 3_600_000;
const t0 = Date.UTC(2026, 8, 28, 0);
const bars = Array.from({ length: 30 }, (_, i) => ({ time: t0 + i * H, open: 100 + i }));

describe("news stats", () => {
  it("priceAt uses the open of the bar containing t and refuses times outside the bars", () => {
    expect(priceAt(bars, t0 + 2.5 * H)).toBe(102);
    expect(priceAt(bars, t0 - 1)).toBeNull();
    expect(priceAt(bars, t0 + 30 * H)).toBeNull();
  });

  it("returnsAfter measures 4 h and 24 h from the same starting price", () => {
    const r = returnsAfter(bars, t0 + H);
    expect(r.p0).toBe(101);
    expect(r.ret4h).toBeCloseTo(105 / 101 - 1);
    expect(r.ret24h).toBeCloseTo(125 / 101 - 1);
    expect(returnsAfter(bars, t0 + 10 * H).ret24h).toBeNull();
  });

  it("accuracy scores only non-neutral calls and ignores flat returns", () => {
    const a = accuracy([
      { sentiment: 0.5, ret4h: 0.01, ret24h: 0.02 },
      { sentiment: -0.4, ret4h: 0.01, ret24h: -0.03 },
      { sentiment: 0.05, ret4h: -0.5, ret24h: -0.5 },
      { sentiment: 0.3, ret4h: 0, ret24h: null },
    ]);
    expect(a).toMatchObject({ articles: 4, calls: 3, hitRate4h: 0.5, hitRate24h: 1 });
    expect(a.avgSignedRet24hPct).toBeCloseTo(2.5);
    expect(accuracy([]).hitRate24h).toBeNull();
  });

  it("correlation", () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(correlation([1, 2], [1, 2])).toBeNull();
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});
