import { describe, it, expect } from "vitest";
import { parseMandate, MandateError } from "@/lib/sessions/mandate";

const base = { symbols: ["BTC/USDT"], capital: 100 };

describe("session mandate", () => {
  it("fills every default from the spec", () => {
    const m = parseMandate(base);
    expect(m).toMatchObject({
      venue: "paper", marketType: "spot", symbols: ["BTC/USDT"], capital: 100, maxLeverage: 1, marginMode: "isolated",
      riskPerTradePct: 1, maxPositionPct: 50, maxOpenPositions: 2, maxTrades: 6, lossLimit: 10, durationMin: 480,
      decisionIntervalMin: 30, cooldownMin: 30, onEnd: "CLOSE_ALL", extensionTimeoutMin: 5, orderStyle: "market",
      debate: false, maxLlmCostUsd: 1,
    });
    expect(m.models).toEqual({ analyst: null, strategist: null, journal: null });
  });

  it("keeps explicit values", () => {
    const m = parseMandate({ ...base, marketType: "swap", maxLeverage: 5, lossLimit: 25, durationMin: 60, debate: true,
      models: { strategist: { provider: "anthropic", model: "claude-sonnet-5" } } });
    expect(m).toMatchObject({ marketType: "swap", maxLeverage: 5, lossLimit: 25, durationMin: 60, debate: true });
    expect(m.models.strategist).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
    expect(m.models.analyst).toBeNull();
  });

  it("rejects leverage on spot", () => {
    expect(() => parseMandate({ ...base, maxLeverage: 2 })).toThrow(MandateError);
  });

  it("rejects symbols outside the catalog and duplicates", () => {
    expect(() => parseMandate({ ...base, symbols: ["NOPE/USDT"] })).toThrow(/NOPE/);
    expect(() => parseMandate({ ...base, symbols: ["BTC/USDT", "BTC/USDT"] })).toThrow(/once/);
    expect(() => parseMandate({ ...base, symbols: [] })).toThrow(MandateError);
  });

  it("rejects a loss limit larger than the capital", () => {
    expect(() => parseMandate({ ...base, lossLimit: 150 })).toThrow(/loss limit/i);
  });

  it("refuses limit orders on paper until P8b", () => {
    expect(() => parseMandate({ ...base, orderStyle: "limit_post_only" })).toThrow(/market/);
  });

  it("rejects unknown keys and out-of-range numbers", () => {
    expect(() => parseMandate({ ...base, foo: 1 })).toThrow(MandateError);
    expect(() => parseMandate({ ...base, decisionIntervalMin: 1 })).toThrow(MandateError);
    expect(() => parseMandate({ ...base, capital: 5 })).toThrow(MandateError);
  });

  it("reports readable issues", () => {
    try {
      parseMandate({ ...base, maxLeverage: 2 });
    } catch (e) {
      expect((e as MandateError).issues[0]).toMatch(/leverage/i);
    }
  });
});
