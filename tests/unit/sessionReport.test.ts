import { describe, it, expect } from "vitest";
import { computeMetrics, metricsText, reasonKey, type ClosedTrade } from "@/lib/sessions/report";

const t = (realizedPnl: number, closedAt: number, o: Partial<ClosedTrade> = {}): ClosedTrade =>
  ({ symbol: "BTC/USDT", side: "LONG", entryPrice: 100, openedQty: 2, initialStop: 95, realizedPnl, closedAt, ...o });

describe("session metrics", () => {
  const m = computeMetrics({
    capital: 1_000, grossPnl: 12, fees: 2, llmCostUsd: 0.5,
    trades: [t(10, 3), t(-5, 1), t(-5, 2), t(10, 4, { initialStop: null })],
    rejectionReasons: ["max trades for this session reached (6/6)", "max trades for this session reached (7/6)", "BTC/USDT is in cooldown after a stop-out (12 min left)"],
    buyAndHold: { symbol: "BTC/USDT", startPrice: 100, endPrice: 103 }, startedAt: 0, endedAt: 3_600_000, cycles: 8,
  });

  it("nets fees and AI cost", () => {
    expect(m).toMatchObject({ netPnl: 10, netAfterLlm: 9.5, returnPct: 1, trades: 4, wins: 2, losses: 2, winRate: 0.5, durationMin: 60, cycles: 8 });
  });
  it("expectancy in R uses the initial stop risk and skips trades without one", () => {
    // risks: $10 each → R = −0.5, −0.5, +1 → mean 0
    expect(m.expectancyR).toBeCloseTo(0, 10);
  });
  it("max drawdown walks closed trades in time order", () => {
    // −5, −10, 0, +10 → peak 0 then trough −10
    expect(m.maxDrawdown).toBe(10);
  });
  it("buy-and-hold and grouped rejections", () => {
    expect(m.buyAndHold?.returnPct).toBeCloseTo(3, 10);
    expect(m.rejections[0]).toEqual({ reason: "max trades for this session reached", count: 2 });
    expect(reasonKey("size clamped 0.5 → 0.3: position cap $500 margin × 1x")).toBe("size clamped");
  });
  it("no trades → nulls, not zeros", () => {
    const e = computeMetrics({ capital: 100, grossPnl: 0, fees: 0, llmCostUsd: 0, trades: [], rejectionReasons: [], buyAndHold: { symbol: "X", startPrice: null, endPrice: 1 }, startedAt: 0, endedAt: 0, cycles: 0 });
    expect(e).toMatchObject({ winRate: null, expectancyR: null, buyAndHold: null, maxDrawdown: 0 });
  });
  it("expectancy R values the stop risk in the account currency (USD/JPY on a CAD account)", () => {
    // 9/30 live trade: short 536 USD/JPY @ 156.845, initial stop 157.18, lost C$1.3451 at 0.009136 CAD per JPY.
    const jpy = computeMetrics({
      capital: 80, grossPnl: -1.3451, fees: 0, llmCostUsd: 0.84, accountCurrency: "CAD",
      trades: [t(-1.3451, 1, { symbol: "USD/JPY", side: "SHORT", entryPrice: 156.845, openedQty: 536, initialStop: 157.18, quoteToAccount: 0.009136 })],
      rejectionReasons: [], buyAndHold: null, startedAt: 0, endedAt: 1, cycles: 9,
    });
    expect(jpy.expectancyR).toBeCloseTo(-0.82, 2);
  });
  it("does not subtract US$ AI cost from a non-USD account", () => {
    const cad = computeMetrics({ capital: 80, grossPnl: -1, fees: 0, llmCostUsd: 2, accountCurrency: "CAD", trades: [], rejectionReasons: [], buyAndHold: null, startedAt: 0, endedAt: 0, cycles: 0 });
    expect(cad).toMatchObject({ accountCurrency: "CAD", netAfterLlm: null });
    expect(computeMetrics({ capital: 80, grossPnl: -1, fees: 0, llmCostUsd: 2, accountCurrency: "USDT", trades: [], rejectionReasons: [], buyAndHold: null, startedAt: 0, endedAt: 0, cycles: 0 }).netAfterLlm).toBe(-3);
  });
  it("text block carries the numbers for the writer", () => {
    const text = metricsText("S", m, [{ ...t(10, 3), reason: "TAKE_PROFIT" }]);
    expect(text).toMatch(/net P&L \$10\.00/);
    expect(text).toMatch(/Buy-and-hold BTC\/USDT .* 3\.00%/);
    expect(text).toMatch(/TAKE_PROFIT/);
  });
});
