import { describe, it, expect } from "vitest";
import { catalogSymbolFor, suggestLevels } from "@/lib/signals/levels";

/** 80 flat 1H bars at 100 (true range 2, so ATR = 2), with optional spikes inside the last 48. */
function bars(spikes: Record<number, { high?: number; low?: number }> = {}) {
  return Array.from({ length: 80 }, (_, i) => ({ time: i * 3_600_000, open: 100, high: 101, low: 99, close: 100, ...(spikes[i] ?? {}) }));
}

describe("suggestLevels", () => {
  const swing = bars({ 50: { low: 95 }, 70: { high: 110 } });

  it("long: stop past the swing low with a 0.25 ATR buffer, Fibonacci extensions of the swing as targets", () => {
    const r = suggestLevels(swing, "BUY", null);
    expect(r.price).toBe(100);
    expect(r.basis).toMatchObject({ swingLow: 95, swingHigh: 110 });
    expect(r.stop).toBeCloseTo(95 - 0.25 * r.basis.atr, 3);
    expect(r.tps).toEqual([109.27, 115, 119.08, 124.27]);
  });

  it("short mirrors it and caps the stop at 3 ATR", () => {
    const r = suggestLevels(swing, "SELL", null);
    expect(r.stop).toBeCloseTo(100 + 3 * r.basis.atr, 3);
    expect(r.tps).toEqual([90.73, 85, 80.92, 75.73]);
  });

  it("keeps the stop at least 1.5 ATR away when the swing is too close", () => {
    const r = suggestLevels(bars({ 60: { low: 99.5 } }), "BUY", null);
    expect(r.stop).toBeCloseTo(100 - 1.5 * r.basis.atr, 3);
  });

  it("uses at least 2 ATR as the swing range on a quiet chart", () => {
    expect(suggestLevels(bars(), "BUY", null).tps[1]).toBe(104);
  });

  it("places the levels around the entry you typed (chart data may be offset from the broker)", () => {
    const a = suggestLevels(swing, "BUY", null), b = suggestLevels(swing, "BUY", 102);
    expect(b.stop).toBeCloseTo(a.stop + 2, 3);
    expect(b.tps).toEqual(a.tps.map((t) => Number((t + 2).toFixed(4))));
  });

  it("refuses with too little data", () => {
    expect(() => suggestLevels(bars().slice(0, 10), "BUY", null)).toThrow(/not enough/);
  });
});

describe("catalogSymbolFor", () => {
  it("maps broker and channel spellings to the market-data catalog", () => {
    expect(catalogSymbolFor("XAUUSD.ec")).toBe("XAU/USD");
    expect(catalogSymbolFor("GOLD")).toBe("XAU/USD");
    expect(catalogSymbolFor("OP")).toBe("OP/USDT");
    expect(catalogSymbolFor("ETHUSD.ec")).toBe("ETH/USDT");
    expect(catalogSymbolFor("EURUSD")).toBe("EUR/USD");
    expect(catalogSymbolFor("NOPE123")).toBeNull();
  });
});
