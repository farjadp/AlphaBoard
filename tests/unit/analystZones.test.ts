import { describe, expect, it } from "vitest";
import { agreements, closedBeyond, nearEvent, scoreReaction, zoneTouched, type Bar } from "@/lib/analyst/zones";

const H = 3_600_000;
const bar = (time: number, open: number, high: number, low: number, close: number): Bar => ({ time, open, high, low, close });

describe("zoneTouched", () => {
  const buy = { kind: "BUY" as const, low: 3850, high: 3865 };

  it("finds the first bar overlapping the zone, from above", () => {
    const bars = [bar(0, 3900, 3905, 3880, 3885), bar(1, 3885, 3886, 3860, 3862), bar(2, 3862, 3870, 3840, 3845)];
    expect(zoneTouched(buy, bars, 0, 0)).toEqual({ at: 1, price: 3865 });
  });

  it("reports the open when price gapped into the zone", () => {
    expect(zoneTouched(buy, [bar(5, 3858, 3860, 3852, 3855)], 0, 0)).toEqual({ at: 5, price: 3858 });
  });

  it("clamps a gap through the zone to its far edge", () => {
    expect(zoneTouched(buy, [bar(5, 3830, 3835, 3820, 3825)], 0, 0)).toBeNull();
    expect(zoneTouched(buy, [bar(5, 3880, 3880, 3820, 3825)], 0, 0)).toEqual({ at: 5, price: 3865 });
  });

  it("ignores bars before `from` and sorts by time", () => {
    const bars = [bar(9, 3900, 3901, 3899, 3900), bar(1, 3860, 3860, 3855, 3858)];
    expect(zoneTouched(buy, bars, 2, 0)).toBeNull();
  });

  it("subtracts the plan offset from feed prices (gold futures above spot)", () => {
    // Feed low 3884 − offset 20 = 3864: inside 3850–3865.
    expect(zoneTouched(buy, [bar(1, 3900, 3902, 3884, 3890)], 0, 20)).toEqual({ at: 1, price: 3865 });
    expect(zoneTouched(buy, [bar(1, 3900, 3902, 3886, 3890)], 0, 20)).toBeNull();
  });

  it("works from below for a sell zone", () => {
    const sell = { kind: "SELL" as const, low: 3940, high: 3976 };
    expect(zoneTouched(sell, [bar(1, 3920, 3941, 3915, 3938)], 0, 0)).toEqual({ at: 1, price: 3940 });
  });
});

describe("closedBeyond", () => {
  const inv = { kind: "INVALIDATION" as const, low: 3976, high: 3976, direction: "ABOVE" };
  const tf = 4 * H;

  it("needs a closed bar closing beyond the level", () => {
    const bars = [bar(0, 3960, 3990, 3950, 3970), bar(tf, 3970, 3995, 3965, 3985)];
    expect(closedBeyond(inv, bars, 0, tf, 2 * tf, 0)).toEqual({ at: tf, close: 3985 });
  });

  it("ignores the still-forming bar", () => {
    const bars = [bar(0, 3970, 3995, 3965, 3985)];
    expect(closedBeyond(inv, bars, 0, tf, tf - 1, 0)).toBeNull();
  });

  it("ignores wicks and the other side", () => {
    const below = { ...inv, direction: "BELOW" };
    const bars = [bar(0, 3980, 3999, 3960, 3978)];
    expect(closedBeyond(inv, bars, 0, tf, tf, 0)).toEqual({ at: 0, close: 3978 });
    expect(closedBeyond(below, bars, 0, tf, tf, 0)).toBeNull();
    expect(closedBeyond(inv, [bar(0, 3960, 3999, 3950, 3970)], 0, tf, tf, 0)).toBeNull();
  });

  it("applies the offset and `from`", () => {
    expect(closedBeyond(inv, [bar(0, 3990, 3999, 3985, 3990)], 0, tf, tf, 20)).toBeNull();
    expect(closedBeyond(inv, [bar(0, 3970, 3995, 3965, 3985)], 1, tf, 2 * tf, 0)).toBeNull();
  });
});

describe("scoreReaction", () => {
  const buy = { kind: "BUY" as const, low: 3850, high: 3865 };
  // need = max(15, 0.3% of 3865 ≈ 11.6) = 15 → respected at 3880.

  it("respected when price moves away by the zone width first", () => {
    const bars = [bar(0, 3870, 3872, 3858, 3860), bar(H, 3860, 3881, 3855, 3878)];
    expect(scoreReaction(buy, bars, 10, 2 * H, 0)).toEqual({ outcome: "RESPECTED", mfe: 16, mae: 10 });
  });

  it("broke when a 1H bar closes beyond the far edge first", () => {
    const bars = [bar(0, 3870, 3872, 3858, 3860), bar(H, 3860, 3866, 3830, 3840), bar(2 * H, 3840, 3890, 3838, 3889)];
    expect(scoreReaction(buy, bars, 10, 3 * H, 0)).toEqual({ outcome: "BROKE", mfe: 7, mae: 35 });
  });

  it("waits while undecided inside 24 h, then calls it unclear", () => {
    const bars = [bar(0, 3870, 3872, 3858, 3860), bar(H, 3860, 3870, 3855, 3862)];
    expect(scoreReaction(buy, bars, 10, 2 * H, 0)).toBeNull();
    expect(scoreReaction(buy, bars, 10, 25 * H, 0)).toEqual({ outcome: "UNCLEAR", mfe: 7, mae: 10 });
  });

  it("does not count a far-edge close of a bar that is still open", () => {
    const bars = [bar(0, 3860, 3862, 3830, 3840)];
    expect(scoreReaction(buy, bars, 10, H - 1, 0)).toBeNull();
  });

  it("mirrors for sell zones, with the offset", () => {
    const sell = { kind: "SELL" as const, low: 3940, high: 3976 };
    // need = 36; feed prices are 20 above the analyst's.
    const bars = [bar(0, 3965, 3975, 3955, 3958), bar(H, 3958, 3960, 3920, 3925)];
    expect(scoreReaction(sell, bars, 10, 2 * H, 20)).toEqual({ outcome: "RESPECTED", mfe: 40, mae: 15 });
  });
});

describe("agreements", () => {
  it("links overlapping same-kind zones of the same symbol from different sources", () => {
    const zones = [
      { id: "a", symbol: "XAU/USD", kind: "SELL" as const, low: 3940, high: 3976, source: "Nima" },
      { id: "b", symbol: "XAU/USD", kind: "SELL" as const, low: 3920, high: 3940, source: "Me" },
      { id: "c", symbol: "XAU/USD", kind: "BUY" as const, low: 3930, high: 3950, source: "Other" },
      { id: "d", symbol: "XAU/USD", kind: "SELL" as const, low: 3950, high: 3960, source: "nima " },
      { id: "e", symbol: "XAG/USD", kind: "SELL" as const, low: 3940, high: 3976, source: "Other" },
    ];
    const m = agreements(zones);
    expect(m.get("a")).toEqual(["Me"]);
    expect(m.get("b")).toEqual(["Nima"]);
    expect(m.get("c")).toBeUndefined();
    expect(m.get("d")).toBeUndefined();
    expect(m.get("e")).toBeUndefined();
  });
});

describe("nearEvent", () => {
  const events = [{ at: "2026-11-06T13:30:00Z", label: "NFP" }];
  it("names an event within ±2 h", () => {
    expect(nearEvent(Date.parse("2026-11-06T12:00:00Z"), events)).toBe("NFP");
    expect(nearEvent(Date.parse("2026-11-06T15:30:00Z"), events)).toBe("NFP");
    expect(nearEvent(Date.parse("2026-11-06T16:00:00Z"), events)).toBeNull();
  });
});
