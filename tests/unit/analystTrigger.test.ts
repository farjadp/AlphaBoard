import { describe, expect, it } from "vitest";
import { findTrigger, trackSignal, TRIGGER_WINDOW_MS } from "@/lib/analyst/trigger";
import type { Bar } from "@/lib/analyst/zones";

const M15 = 900_000;
const bar = (i: number, open: number, high: number, low: number, close: number): Bar => ({ time: i * M15, open, high, low, close });
const buy = { kind: "BUY" as const, low: 3850, high: 3865 };
const sell = { kind: "SELL" as const, low: 3940, high: 3976 };

describe("findTrigger", () => {
  // Touched during bar 3 (time 3 * M15 + 1).
  const touch = 3 * M15 + 60_000;
  const base = [bar(0, 3880, 3885, 3875, 3878), bar(1, 3878, 3880, 3868, 3870), bar(2, 3870, 3872, 3862, 3864), bar(3, 3864, 3866, 3852, 3858)];

  it("fires when a closed candle after the touch closes above the high of the 3 before it", () => {
    const bars = [...base, bar(4, 3858, 3863, 3855, 3861), bar(5, 3861, 3870, 3860, 3868)];
    // Bar 4: prev highs 3880, 3872, 3866 → 3861 is not above. Bar 5: prev 3872, 3866, 3863 → 3868 is not above 3872.
    expect(findTrigger(buy, bars, touch, M15, 6 * M15, 0)).toBeNull();
    const more = [...bars, bar(6, 3868, 3876, 3866, 3874)];
    // Bar 6: prev 3866, 3863, 3870 → 3874 > 3870.
    expect(findTrigger(buy, more, touch, M15, 7 * M15, 0)).toEqual({ kind: "TRIGGERED", at: 6 * M15, price: 3874 });
  });

  it("ignores the candle still forming", () => {
    // Bar 4 closes 3882 above the highs of bars 1-3 (3880, 3872, 3866).
    const bars = [...base, bar(4, 3858, 3884, 3855, 3882)];
    expect(findTrigger(buy, bars, touch, M15, 5 * M15 - 1, 0)).toBeNull();
    expect(findTrigger(buy, bars, touch, M15, 5 * M15, 0)).toEqual({ kind: "TRIGGERED", at: 4 * M15, price: 3882 });
  });

  it("is cancelled by a close beyond the far edge first", () => {
    const bars = [...base, bar(4, 3858, 3860, 3840, 3845), bar(5, 3845, 3890, 3844, 3888)];
    expect(findTrigger(buy, bars, touch, M15, 6 * M15, 0)).toEqual({ kind: "CANCELLED", at: 4 * M15, close: 3845 });
  });

  it("expires after the window without a trigger", () => {
    expect(findTrigger(buy, base, touch, M15, touch + TRIGGER_WINDOW_MS, 0)).toEqual({ kind: "EXPIRED", at: touch + TRIGGER_WINDOW_MS });
  });

  it("mirrors for a sell, with the feed offset", () => {
    // Feed is 20 above the analyst's prices.
    const bars = [bar(0, 3950, 3958, 3945, 3955), bar(1, 3955, 3965, 3952, 3962), bar(2, 3962, 3975, 3960, 3970), bar(3, 3970, 3972, 3955, 3957)].map((b) => ({ ...b, open: b.open + 20, high: b.high + 20, low: b.low + 20, close: b.close + 20 }));
    // Touch at bar 1; bar 3 closes 3957 < min low of bars 0-2 (3945)? no. Add bar 4 closing 3940 < min(3952, 3960, 3955).
    const all = [...bars, { time: 4 * M15, open: 3977, high: 3978, low: 3958, close: 3960 }];
    expect(findTrigger(sell, all, M15 + 1, M15, 5 * M15, 20)).toEqual({ kind: "TRIGGERED", at: 4 * M15, price: 3940 });
  });
});

describe("trackSignal", () => {
  const M5 = 300_000;
  const b = (i: number, high: number, low: number): Bar => ({ time: i * M5, open: low, high, low, close: high });
  const targets = [105, 108, 134, 155];

  it("reports targets in order and moves the stop to entry after TP1", () => {
    const r = trackSignal("BUY", 100, 87, targets, 0, [b(0, 101, 99), b(1, 106, 100.5), b(2, 109, 104)], 0, 0);
    expect(r).toEqual({ events: [{ kind: "TP", index: 0, at: M5 }, { kind: "TP", index: 1, at: 2 * M5 }], tpHit: 2, closed: null });
    const after = trackSignal("BUY", 100, 87, targets, 2, [b(3, 107, 99.5)], 3 * M5, 0);
    expect(after).toEqual({ events: [{ kind: "BREAKEVEN", at: 3 * M5 }], tpHit: 2, closed: "BREAKEVEN" });
  });

  it("stops out before TP1, and takes the stop first when one candle reaches both", () => {
    expect(trackSignal("BUY", 100, 87, targets, 0, [b(0, 101, 86)], 0, 0)).toEqual({ events: [{ kind: "STOP", at: 0 }], tpHit: 0, closed: "STOP" });
    expect(trackSignal("BUY", 100, 87, targets, 0, [b(0, 106, 86)], 0, 0).closed).toBe("STOP");
  });

  it("closes when every target is reached, and mirrors for a sell", () => {
    expect(trackSignal("BUY", 100, 87, [105, 108], 0, [b(0, 110, 100)], 0, 0)).toEqual({
      events: [{ kind: "TP", index: 0, at: 0 }, { kind: "TP", index: 1, at: 0 }], tpHit: 2, closed: "ALL_TP",
    });
    expect(trackSignal("SELL", 100, 113, [95, 92], 0, [b(0, 101, 94)], 0, 0)).toEqual({ events: [{ kind: "TP", index: 0, at: 0 }], tpHit: 1, closed: null });
  });
});
