import { describe, it, expect } from "vitest";
import { computePnl } from "@/lib/journal/pnl";

describe("computePnl", () => {
  it("long 1x: +10% move minus round-trip fees", () => {
    const r = computePnl({ entryPrice: 100, exitPrice: 110, position: "LONG", feeRatePercent: 0.05 })!;
    expect(r.gross).toBeCloseTo(10, 10);
    expect(r.feeImpact).toBeCloseTo(0.1, 10);
    expect(r.net).toBeCloseTo(9.9, 10);
  });
  it("short with leverage scales both PnL and fees", () => {
    const r = computePnl({ entryPrice: 100, exitPrice: 95, position: "SHORT", leverage: 10, feeRatePercent: 0.05 })!;
    expect(r.gross).toBeCloseTo(50, 10);
    expect(r.feeImpact).toBeCloseTo(1, 10);
    expect(r.net).toBeCloseTo(49, 10);
  });
  it("returns null for non-positive prices instead of Infinity/NaN", () => {
    expect(computePnl({ entryPrice: 0, exitPrice: 10, position: "LONG" })).toBeNull();
    expect(computePnl({ entryPrice: 10, exitPrice: -1, position: "LONG" })).toBeNull();
  });
});
