import { describe, it, expect } from "vitest";
import { alertCondition, buildTradePlan, firstSentence } from "@/lib/market/tradePlan";

describe("buildTradePlan", () => {
  it("derives direction, distances and risk:reward for a long", () => {
    const p = buildTradePlan({ signal: "BUY", entry: 100, stopLoss: 95, takeProfit: 110, reasoning: "Trend is up. More text." });
    expect(p.direction).toBe("long");
    expect(p.riskPct).toBeCloseTo(5);
    expect(p.rewardPct).toBeCloseTo(10);
    expect(p.rr).toBeCloseTo(2);
    expect(p.consistent).toBe(true);
    expect(p.because).toBe("Trend is up.");
  });

  it("derives a short", () => {
    const p = buildTradePlan({ signal: "SELL", entry: 100, stopLoss: 104, takeProfit: 90, reasoning: "" });
    expect(p.direction).toBe("short");
    expect(p.rr).toBeCloseTo(2.5);
    expect(p.consistent).toBe(true);
  });

  it("flags levels that contradict the direction and withholds risk:reward", () => {
    const p = buildTradePlan({ signal: "BUY", entry: 100, stopLoss: 105, takeProfit: 110, reasoning: "" });
    expect(p.consistent).toBe(false);
    expect(p.rr).toBeNull();
  });

  it("treats HOLD as no trade", () => {
    const p = buildTradePlan({ signal: "HOLD", entry: 100, stopLoss: 95, takeProfit: 110, reasoning: "Wait." });
    expect(p.direction).toBe("none");
    expect(p.rr).toBeNull();
  });

  it("never divides by zero", () => {
    const p = buildTradePlan({ signal: "BUY", entry: 0, stopLoss: 0, takeProfit: 0, reasoning: "" });
    expect(p.rr).toBeNull();
    expect(p.riskPct).toBeNull();
  });
});

describe("firstSentence", () => {
  it("cuts long text at a word boundary", () => {
    const s = firstSentence("word ".repeat(80), 40);
    expect(s.length).toBeLessThanOrEqual(41);
    expect(s.endsWith("…")).toBe(true);
  });
  it("does not split on decimal points", () => {
    expect(firstSentence("RSI is 58.2 and rising. Next.")).toBe("RSI is 58.2 and rising.");
  });
});

describe("alertCondition", () => {
  it("fires above when the target is over the current price", () => {
    expect(alertCondition(100, 105)).toBe("above");
    expect(alertCondition(100, 95)).toBe("below");
  });
});
