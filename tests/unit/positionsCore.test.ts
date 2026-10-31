import { describe, expect, it } from "vitest";
import {
  breakevenStop, excursionR, exitAtPrice, legsHit, liquidationPrice, manualLevel, nextExtremes, positionR,
  protectiveLevel, scanExit, trailingStop, validateLadder,
} from "@/lib/trading/positions";

const long = { side: "LONG" as const, entryPrice: 100, leverage: 5, stopLoss: 95, takeProfit: 110 };
const short = { side: "SHORT" as const, entryPrice: 100, leverage: 5, stopLoss: 105, takeProfit: 90 };
const bar = (time: number, o: number, h: number, l: number, c: number) => ({ time, open: o, high: h, low: l, close: c });

describe("exits", () => {
  it("liquidation beats a stop placed beyond it", () => {
    expect(liquidationPrice("LONG", 100, 5)).toBe(80);
    expect(protectiveLevel(long)).toEqual({ level: 95, reason: "STOP_LOSS" });
    expect(protectiveLevel({ ...long, stopLoss: 70 })).toEqual({ level: 80, reason: "LIQUIDATION" });
    expect(protectiveLevel({ ...long, stopLoss: null })).toEqual({ level: 80, reason: "LIQUIDATION" });
    expect(protectiveLevel({ ...long, stopLoss: null, leverage: 1 })).toBeNull();
    expect(protectiveLevel({ ...short, stopLoss: null, leverage: 1 })).toEqual({ level: 200, reason: "LIQUIDATION" });
  });

  it("scans bars in order, skips bars before fromTime, stop wins a same-bar tie, gaps fill at the open", () => {
    const bars = [bar(0, 100, 101, 94, 100), bar(1, 100, 111, 94, 100), bar(2, 100, 112, 100, 110)];
    expect(scanExit(long, bars, 1)).toEqual({ reason: "STOP_LOSS", level: 95, at: 1 });
    expect(scanExit(long, bars, 2)).toEqual({ reason: "TAKE_PROFIT", level: 110, at: 2 });
    expect(scanExit(long, [bar(5, 90, 92, 88, 91)], 0)).toEqual({ reason: "STOP_LOSS", level: 90, at: 5 });
    expect(scanExit(short, [bar(0, 100, 104, 89, 95)], 0)).toEqual({ reason: "TAKE_PROFIT", level: 90, at: 0 });
    expect(scanExit({ ...long, stopLoss: null, takeProfit: null }, [bar(0, 100, 100, 81, 90)], 0)).toBeNull();
    expect(scanExit({ ...long, stopLoss: null, takeProfit: null }, [bar(0, 100, 100, 79, 90)], 0)?.reason).toBe("LIQUIDATION");
  });

  it("spot check with exchange-stop slack", () => {
    expect(exitAtPrice(long, 95)).toBe("STOP_LOSS");
    expect(exitAtPrice(long, 95, { stopSlack: 0.003 })).toBeNull();
    expect(exitAtPrice(long, 94.7, { stopSlack: 0.003 })).toBe("STOP_LOSS");
    expect(exitAtPrice(long, 110)).toBe("TAKE_PROFIT");
    expect(exitAtPrice(short, 105.1)).toBe("STOP_LOSS");
    expect(exitAtPrice(long, 100)).toBeNull();
  });
});

describe("excursion and R", () => {
  it("tracks best and worst from prices or bar ranges", () => {
    const p = { side: "LONG" as const, entryPrice: 100, bestPrice: null, worstPrice: null };
    expect(nextExtremes(p, 103)).toEqual({ bestPrice: 103, worstPrice: 100 });
    expect(nextExtremes({ ...p, bestPrice: 103, worstPrice: 100 }, { high: 104, low: 97 })).toEqual({ bestPrice: 104, worstPrice: 97 });
    expect(nextExtremes({ ...p, bestPrice: 104, worstPrice: 97 }, 100)).toBeNull();
    expect(nextExtremes({ side: "SHORT", entryPrice: 100, bestPrice: null, worstPrice: null }, { high: 102, low: 96 })).toEqual({ bestPrice: 96, worstPrice: 102 });
  });

  it("R uses the initial stop and MFE/MAE are positive multiples", () => {
    const p = { side: "LONG" as const, entryPrice: 100, initialStop: 95, stopLoss: 100, bestPrice: 110, worstPrice: 97 };
    expect(positionR(p, 105)).toBe(1);
    expect(positionR({ ...p, initialStop: null }, 105)).toBeNull(); // stop at entry → no risk defined
    expect(excursionR(p)).toEqual({ mfeR: 2, maeR: 0.6 });
    expect(excursionR({ ...p, initialStop: null })).toBeNull();
  });
});

describe("management rules", () => {
  it("breakeven needs profit past the buffer and only tightens", () => {
    expect(breakevenStop(long, 101, 0.5)).toEqual({ stop: 100.5 });
    expect(breakevenStop(long, 100.4, 0.5)).toMatchObject({ problem: { code: "NOT_IN_PROFIT" } });
    expect(breakevenStop({ ...long, stopLoss: 101 }, 105)).toMatchObject({ problem: { code: "ALREADY_PROTECTED" } });
    expect(breakevenStop(short, 98, 0.5)).toEqual({ stop: 99.5 });
  });

  it("trailing follows at mult × ATR toward the price only, after activation", () => {
    expect(trailingStop(long, { price: 110, atr: 2, mult: 2 })).toEqual({ stop: 106 });
    expect(trailingStop({ ...long, stopLoss: 107 }, { price: 110, atr: 2, mult: 2 })).toBeNull();
    expect(trailingStop(long, { price: 103, atr: 2, mult: 2, activateAtR: 1 })).toBeNull(); // 0.6R so far
    expect(trailingStop(long, { price: 106, atr: 2, mult: 2, activateAtR: 1 })).toEqual({ stop: 102 });
    expect(trailingStop(short, { price: 90, atr: 1, mult: 3 })).toEqual({ stop: 93 });
    expect(trailingStop(long, { price: 110, atr: null, mult: 2 })).toMatchObject({ problem: { code: "NO_ATR" } });
    expect(trailingStop({ ...long, stopLoss: 105.9 }, { price: 110, atr: 2, mult: 2, minStep: 0.5 })).toBeNull();
  });

  it("manual levels sit on the right side and stops only tighten unless loosening is allowed", () => {
    expect(manualLevel(long, 104, { stopLoss: 99 })).toBeNull();
    expect(manualLevel(long, 104, { stopLoss: 105 })?.code).toBe("BAD_LEVEL");
    expect(manualLevel(long, 104, { stopLoss: 93 })?.message).toContain("toward");
    expect(manualLevel(long, 104, { stopLoss: 93 }, { allowLoosen: true })).toBeNull();
    expect(manualLevel(long, 104, { takeProfit: 103 })?.code).toBe("BAD_LEVEL");
  });

  it("ladders are ordered, on the winning side and sum to at most 100%", () => {
    expect(validateLadder("LONG", 100, [{ price: 105, fraction: 0.5 }, { price: 110, fraction: 0.5 }])).toBeNull();
    expect(validateLadder("LONG", 100, [{ price: 110, fraction: 0.5 }, { price: 105, fraction: 0.5 }])?.message).toContain("Target 2");
    expect(validateLadder("SHORT", 100, [{ price: 101, fraction: 1 }])?.code).toBe("BAD_LEVEL");
    expect(validateLadder("LONG", 100, [{ price: 105, fraction: 0.6 }, { price: 110, fraction: 0.6 }])?.message).toContain("100%");
    expect(legsHit("LONG", [{ price: 105, fraction: 0.5 }, { price: 110, fraction: 0.5 }], { high: 111, low: 99 })).toHaveLength(2);
    expect(legsHit("LONG", [{ price: 105, fraction: 0.5 }, { price: 110, fraction: 0.5 }], { high: 106, low: 99 })).toHaveLength(1);
    expect(legsHit("SHORT", [{ price: 95, fraction: 1 }], { high: 101, low: 96 })).toHaveLength(0);
  });
});
