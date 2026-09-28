import { describe, it, expect } from "vitest";
import { confidenceBucket, modelFamily, performanceReport, summarize, type EvaluatedRow } from "@/lib/eval/metrics";

let n = 0;
const row = (status: EvaluatedRow["status"], r: number | null, extra: Partial<EvaluatedRow> = {}): EvaluatedRow => ({
  status, rMultiple: r, confidence: 65, symbol: "BTC/USDT", timeframe: "1H", model: "gpt-5.4-mini",
  resolvedAt: status === "OPEN" ? null : new Date(Date.UTC(2026, 8, 1) + n++ * 3_600_000), ...extra,
});

describe("summarize", () => {
  it("computes win rate, expectancy, profit factor and total R over resolved trades only", () => {
    const s = summarize([row("TP_HIT", 2), row("SL_HIT", -1), row("TP_HIT", 1.5), row("EXPIRED", -0.5), row("OPEN", null), row("NO_FILL", null), row("INVALID", null)]);
    expect(s).toMatchObject({ trades: 4, wins: 2, open: 1, noFill: 1, invalid: 1 });
    expect(s.winRate).toBeCloseTo(50, 10);
    expect(s.expectancyR).toBeCloseTo(0.5, 10);
    expect(s.totalR).toBeCloseTo(2, 10);
    expect(s.profitFactor).toBeCloseTo(3.5 / 1.5, 10);
    expect(s.avgWinR).toBeCloseTo(1.75, 10);
    expect(s.avgLossR).toBeCloseTo(-0.75, 10);
  });
  it("returns nulls (not zeros) when there is nothing to measure", () => {
    expect(summarize([row("OPEN", null)])).toMatchObject({ trades: 0, winRate: null, expectancyR: null, profitFactor: null, maxDrawdownR: null });
  });
  it("profit factor is null with no losing trades", () => {
    expect(summarize([row("TP_HIT", 2)]).profitFactor).toBeNull();
  });
  it("max drawdown is the deepest peak-to-trough fall of cumulative R, in resolution order", () => {
    // cumulative: 2, 1, 0, -1, 1 → peak 2, trough -1 → DD 3
    const rows = [row("TP_HIT", 2), row("SL_HIT", -1), row("SL_HIT", -1), row("SL_HIT", -1), row("TP_HIT", 2)];
    expect(summarize([...rows].reverse()).maxDrawdownR).toBeCloseTo(3, 10);
  });
});

describe("confidenceBucket", () => {
  it("groups stated confidence into bands", () => {
    expect([10, 49, 50, 64, 75, 80, 100].map(confidenceBucket)).toEqual(["<50", "<50", "50–59", "60–69", "70–79", "80+", "80+"]);
  });
});

describe("modelFamily", () => {
  it("folds dated snapshots into their model", () => {
    expect(["gpt-5.4-mini-2026-03-17", "gpt-4o-2024-08-06", "claude-opus-4-8", "claude-3-5-sonnet-20241022", "deepseek-v4-pro"].map(modelFamily))
      .toEqual(["gpt-5.4-mini", "gpt-4o", "claude-opus-4-8", "claude-3-5-sonnet", "deepseek-v4-pro"]);
  });
});

describe("performanceReport", () => {
  it("builds the cumulative-R curve, breakdowns and calibration", () => {
    const rows = [
      row("TP_HIT", 2, { confidence: 82, symbol: "ETH/USDT" }),
      row("SL_HIT", -1, { confidence: 85, timeframe: "4H" }),
      row("TP_HIT", 1, { confidence: 55, model: "gpt-4o-2024-08-06" }),
      row("OPEN", null),
    ];
    const rep = performanceReport(rows);
    expect(rep.curve.map((p) => p.cumR)).toEqual([2, 1, 2]);
    expect(rep.bySymbol.find((g) => g.key === "ETH/USDT")).toMatchObject({ trades: 1, wins: 1 });
    expect(rep.byModel.map((g) => g.key).sort()).toEqual(["gpt-4o", "gpt-5.4-mini"]);
    expect(rep.byConfidence.map((g) => g.key)).toEqual(["50–59", "60–69", "80+"]);
    const high = rep.calibration.find((c) => c.bucket === "80+")!;
    expect(high).toMatchObject({ trades: 2, winRate: 50 });
    expect(high.avgConfidence).toBeCloseTo(83.5, 10);
    expect(rep.calibration.find((c) => c.bucket === "<50")).toMatchObject({ trades: 0, winRate: null, avgConfidence: null });
  });
});
