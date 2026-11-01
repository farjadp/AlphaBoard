import { describe, expect, it } from "vitest";
import { convertExit, exitPrice, exitText } from "@/components/trade/ExitUnit";

describe("exit unit fields", () => {
  it("reads a price field as is and a percent field from the reference", () => {
    expect(exitPrice("98.5", "price", "LONG", "stop", 100)).toBe(98.5);
    expect(exitPrice("2", "pct", "LONG", "stop", 100)).toBeCloseTo(98);
    expect(exitPrice("2,5", "pct", "SHORT", "target", 100)).toBeCloseTo(97.5);
  });
  it("is empty without text, or a percent without a reference price", () => {
    expect(exitPrice("", "pct", "LONG", "stop", 100)).toBeNull();
    expect(exitPrice("2", "pct", "LONG", "stop", null)).toBeNull();
  });
  it("keeps the same level when switching units", () => {
    expect(convertExit("98", "price", "pct", "LONG", "stop", 100)).toBe("2");
    expect(convertExit("3", "pct", "price", "SHORT", "target", 2650)).toBe("2570.5");
    expect(convertExit("", "price", "pct", "LONG", "stop", 100)).toBe("");
  });
});

describe("exit unit round trip", () => {
  it("keeps the exact current level when its percent is left as converted", () => {
    const shown = convertExit("76456.6", "price", "pct", "LONG", "stop", 78022.86);
    expect(exitPrice(shown, "pct", "LONG", "stop", 78022.86, 76456.6)).toBe(76456.6);
    expect(exitPrice("2.5", "pct", "LONG", "stop", 78022.86, 76456.6)).toBeCloseTo(76072.29, 1);
  });
});

describe("exit price field display", () => {
  it("shows a stored level without float noise and keeps it exactly when untouched", () => {
    expect(exitText(2710.715964123)).toBe("2710.716");
    expect(exitPrice("2710.716", "price", "SHORT", "stop", 2258.93, 2710.715964123)).toBe(2710.715964123);
    expect(exitPrice("2700", "price", "SHORT", "stop", 2258.93, 2710.715964123)).toBe(2700);
  });
});
