import { describe, it, expect } from "vitest";
import { alertToDto, chartLessonToDto, journalToDto, lessonToDto, signalToDto } from "@/lib/db/mappers";

const d = new Date("2026-09-10T12:00:00Z");

describe("db → client mappers", () => {
  it("journal: nulls become undefined, screenshot becomes an attachment URL", () => {
    const dto = journalToDto({
      id: "j1", userId: "u", legacyId: null, symbol: "ETH/USDT", position: "SHORT", status: "CLOSED",
      entryPrice: 2000, exitPrice: 1900, pnlPercent: 4.9, grossPnlPercent: 5, feeRatePercent: null, pnlSource: "calculated",
      emotion: "Neutral", notes: "", leverage: null, margin: 50, marginMode: "Isolated", screenshotId: "a1", sessionPositionId: null,
      postMortem: { outcome: "WIN" }, openedAt: d, closedAt: d, createdAt: d, updatedAt: d,
    });
    expect(dto).toMatchObject({ id: "j1", timestamp: d.toISOString(), position: "SHORT", screenshotUrl: "/api/attachments/a1", margin: 50 });
    expect("leverage" in dto).toBe(false);
    expect("feeRatePercent" in dto).toBe(false);
  });

  it("signal: maps DB column names to the archive's wire names", () => {
    const dto = signalToDto({
      id: "s1", userId: "u", legacyId: null, symbol: "BTC/USDT", timeframe: "4H", signal: "HOLD", confidence: 50,
      priceAtSignal: 83618.9, entry: 83618.9, stopLoss: 82400, takeProfit: 84800, tradeStyle: "Swing",
      riskManagement: { leverage: "2x" }, supportResistance: null, safeEntries: null, reasoning: "r",
      indicatorsBreakdown: [], provider: "openai", model: "gpt-4o", createdAt: d,
    });
    expect(dto).toMatchObject({ price: 83618.9, risk_management: { leverage: "2x" }, indicators_breakdown: [], timestamp: d.toISOString() });
    expect("evaluation" in dto).toBe(false);
  });

  it("signal: carries its evaluated outcome when there is one", () => {
    const base = {
      id: "s2", userId: "u", legacyId: null, symbol: "BTC/USDT", timeframe: "1H", signal: "BUY", confidence: 70,
      priceAtSignal: 100, entry: 100, stopLoss: 95, takeProfit: 110, tradeStyle: null, riskManagement: null, supportResistance: null,
      safeEntries: null, reasoning: "r", indicatorsBreakdown: null, provider: "openai", model: "gpt-5.4-mini", createdAt: d,
    };
    const dto = signalToDto({ ...base, evaluation: { status: "TP_HIT", rMultiple: 2, resolvedAt: d, note: null } });
    expect(dto.evaluation).toEqual({ status: "TP_HIT", rMultiple: 2, resolvedAt: d.toISOString(), note: null });
  });

  it("lesson: tradeId falls back to empty string when the trade was deleted", () => {
    const dto = lessonToDto({
      id: "l1", userId: "u", legacyId: null, journalEntryId: null, symbol: "SOL/USDT", position: "LONG", outcome: "LOSS",
      pnlPercent: -2, timeframe: null, rootCause: "rc", mistakes: ["m"], strengths: [], lesson: "l", tags: ["t"], emotion: null, createdAt: d,
    });
    expect(dto.tradeId).toBe("");
    expect(dto.timestamp).toBe(d.toISOString());
  });

  it("chart lesson: chart images become attachment URLs; malformed chart rows are dropped", () => {
    const dto = chartLessonToDto({
      id: "c1", userId: "u", legacyId: null, symbol: null, overallSignal: "BUY", confluenceScore: 70, summary: "s", lesson: "l",
      patterns: [], tags: [], mistakes: [], strengths: [], createdAt: d,
      charts: [{ timeframe: "4H", attachmentId: "img1", annotations: [], signal: "BUY", bias: "b" }, { nonsense: true }],
    });
    expect(dto.charts).toHaveLength(1);
    expect(dto.charts[0].imageDataUrl).toBe("/api/attachments/img1");
  });

  it("alert: dates serialize to ISO strings", () => {
    const dto = alertToDto({ id: "a", userId: "u", legacyId: null, symbol: "XAU/USD", targetPrice: 4200, condition: "above", triggered: true, triggeredAt: d, triggerPrice: 4201.5, lastCheckedAt: d, createdAt: d });
    expect(dto).toEqual({ id: "a", symbol: "XAU/USD", targetPrice: 4200, condition: "above", triggered: true, triggeredAt: d.toISOString(), triggerPrice: 4201.5, createdAt: d.toISOString() });
  });
});
