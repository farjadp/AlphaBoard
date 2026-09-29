import { describe, it, expect } from "vitest";
import { parseLegacyData, collectLegacyImages } from "@/lib/import/legacy";

const png = "data:image/png;base64," + Buffer.from("img").toString("base64");

describe("parseLegacyData", () => {
  it("keeps valid rows, drops garbage, and counts what was skipped", () => {
    const out = parseLegacyData({
      watchlist: ["BTC/USDT", "NOT_A_SYMBOL", "BTC/USDT", "XAU/USD"],
      alerts: [
        { id: "a1", symbol: "BTC/USDT", targetPrice: 90000, condition: "above", createdAt: "2026-09-01T00:00:00Z", triggered: false },
        { id: "a2", symbol: "BTC/USDT", targetPrice: -1, condition: "sideways" },
      ],
      journal: [
        { id: "j1", timestamp: "2026-09-01T00:00:00Z", symbol: "BTC/USDT", position: "LONG", entryPrice: 100, exitPrice: 110, emotion: "FOMO", notes: "n", status: "CLOSED", screenshotUrl: png },
        { id: "j2", symbol: "BTC/USDT", position: "LONG", entryPrice: "abc" },
      ],
      signals: "not an array",
      lessons: [{ id: "l1", tradeId: "j1", symbol: "BTC/USDT", position: "LONG", outcome: "WIN", rootCause: "r", mistakes: [], strengths: [], lesson: "x", tags: [], timestamp: "2026-09-02T00:00:00Z" }],
      chartLessons: [{ id: "c1", createdAt: "2026-09-03T00:00:00Z", overallSignal: "BUY", confluenceScore: 80, summary: "s", lesson: "l", patterns: [], tags: [], charts: [{ timeframe: "4H", imageDataUrl: png, annotations: [] }] }],
    });
    expect(out.watchlist).toEqual(["BTC/USDT", "XAU/USD"]);
    expect(out.alerts.map((a) => a.legacyId)).toEqual(["a1"]);
    expect(out.journal).toHaveLength(1);
    expect(out.journal[0].screenshot?.dataUrl).toBe(png);
    expect(out.signals).toEqual([]);
    expect(out.lessons[0].journalLegacyId).toBe("j1");
    expect(out.chartLessons[0].charts[0].image.dataUrl).toBe(png);
    expect(out.skipped).toEqual({ alerts: 1, journal: 1, signals: 0, lessons: 0, chartLessons: 0 });
  });

  it("treats a completely empty browser as nothing to import", () => {
    const out = parseLegacyData({});
    expect(out.total).toBe(0);
  });

  it("collects images of valid rows only, and rewrites them to attachment ids in the raw payload", () => {
    const raw = {
      journal: [
        { id: "j1", timestamp: "2026-09-01T00:00:00Z", symbol: "X", position: "SHORT", entryPrice: 1, emotion: "Neutral", notes: "", status: "OPEN", screenshotUrl: png },
        { id: "bad", position: "SIDEWAYS", entryPrice: -1, screenshotUrl: png },
      ],
      chartLessons: [{ id: "c1", createdAt: "2026-09-03T00:00:00Z", overallSignal: "HOLD", confluenceScore: 1, summary: "", lesson: "", patterns: [], tags: [], charts: [{ timeframe: "1H", imageDataUrl: png, annotations: [] }, { timeframe: "4H", imageDataUrl: png, annotations: [] }] }],
    };
    const images = collectLegacyImages(raw);
    expect(images).toHaveLength(3);
    images.forEach((img, i) => img.setAttachmentId(`att${i}`));
    const parsed = parseLegacyData(raw);
    expect(parsed.journal[0].screenshot).toEqual({ attachmentId: "att0" });
    expect(parsed.chartLessons[0].charts.map((c) => c.image)).toEqual([{ attachmentId: "att1" }, { attachmentId: "att2" }]);
    expect(JSON.stringify(raw)).not.toContain("data:image"); // nothing heavy left for /api/import
  });
});

describe("parseLegacyData — chart studies whose images failed to upload", () => {
  it("keeps the lesson text even when no chart image survived", () => {
    const out = parseLegacyData({
      chartLessons: [{ id: "c1", createdAt: "2026-09-03T00:00:00Z", overallSignal: "HOLD", confluenceScore: 40, summary: "s", lesson: "Range edges only", patterns: [], tags: [],
        charts: [{ timeframe: "4H", attachmentId: "", annotations: [] }] }],
    });
    expect(out.chartLessons).toHaveLength(1);
    expect(out.chartLessons[0].lesson).toBe("Range edges only");
    expect(out.chartLessons[0].charts).toEqual([]);
  });
});
