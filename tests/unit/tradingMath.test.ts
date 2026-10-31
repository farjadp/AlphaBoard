import { describe, expect, it } from "vitest";
import { dirOf, exitProblem, favourMove, grossPnl, pnlPct, rMultiple, tightens } from "@/lib/trading/math";

describe("trading math", () => {
  it("maps every side spelling to a direction", () => {
    expect(dirOf("LONG")).toBe(1);
    expect(dirOf("BUY")).toBe(1);
    expect(dirOf("SHORT")).toBe(-1);
    expect(dirOf("SELL")).toBe(-1);
  });

  it("R-multiple is signed in the trade's favour and null without risk", () => {
    expect(rMultiple({ side: "LONG", entry: 100, stop: 95, price: 110 })).toBe(2);
    expect(rMultiple({ side: "SHORT", entry: 100, stop: 105, price: 110 })).toBe(-2);
    expect(rMultiple({ side: "SELL", entry: 100, stop: 105, price: 90 })).toBe(2);
    expect(rMultiple({ side: "LONG", entry: 100, stop: 100, price: 110 })).toBeNull();
  });

  it("gross P&L and percentage move follow the side", () => {
    expect(grossPnl({ side: "LONG", qty: 2, entry: 100 }, 110)).toBe(20);
    expect(grossPnl({ side: "SHORT", qty: 2, entry: 100 }, 110)).toBe(-20);
    expect(favourMove("SHORT", 100, 90)).toBe(10);
    expect(pnlPct({ side: "LONG", entry: 100, price: 105, leverage: 3 })).toBeCloseTo(15);
    expect(pnlPct({ side: "LONG", entry: 0, price: 105 })).toBeNull();
  });

  it("exit problems name the wrong side", () => {
    expect(exitProblem("LONG", 100, 95, 110)).toBeNull();
    expect(exitProblem("LONG", 100, 101)?.kind).toBe("BAD_STOP");
    expect(exitProblem("LONG", 100, null, 99)?.kind).toBe("BAD_TARGET");
    expect(exitProblem("SHORT", 100, 99)?.message).toContain("above");
    expect(exitProblem("SHORT", 100, 105, 95)).toBeNull();
  });

  it("a stop only tightens toward the price", () => {
    expect(tightens("LONG", 90, 95)).toBe(true);
    expect(tightens("LONG", 95, 90)).toBe(false);
    expect(tightens("SHORT", 110, 105)).toBe(true);
    expect(tightens("SHORT", null, 105)).toBe(true);
  });
});
