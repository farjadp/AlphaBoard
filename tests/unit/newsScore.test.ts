import { describe, expect, it } from "vitest";
import { articleWeight, corroboration, corroborationFactor, newsIndex, recencyFactor } from "@/lib/news/score";
import { ASSET_CATALOG } from "@/lib/assetCatalog";
import { NEWS_ALIASES } from "@/lib/news/aliases";

describe("news scoring", () => {
  it("recency halves every 6 h for crypto and every 24 h otherwise", () => {
    expect(recencyFactor(0, "crypto")).toBe(1);
    expect(recencyFactor(6, "crypto")).toBeCloseTo(0.5);
    expect(recencyFactor(24, "forex")).toBeCloseTo(0.5);
    expect(recencyFactor(-1, "crypto")).toBe(1);
  });

  it("corroboration: 1 + 0.25 per extra independent publisher, capped at 1.5", () => {
    expect(corroborationFactor(1)).toBe(1);
    expect(corroborationFactor(2)).toBe(1.25);
    expect(corroborationFactor(9)).toBe(1.5);
  });

  it("counts distinct publishers of the same story, not repeats from one publisher", () => {
    const k = corroboration([
      { id: "a", title: "SEC approves spot Solana ETF applications", publisherKey: "reuters" },
      { id: "b", title: "SEC approves first spot Solana ETF applications", publisherKey: "coindesk" },
      { id: "c", title: "SEC approves spot Solana ETF applications today", publisherKey: "reuters" },
      { id: "d", title: "Gold slips as dollar firms", publisherKey: "reuters" },
    ]);
    expect(k.get("a")).toBe(2);
    expect(k.get("b")).toBe(2);
    expect(k.get("d")).toBe(1);
  });

  it("article weight multiplies publisher, recency, relevance and corroboration", () => {
    expect(articleWeight({ publisherWeight: 0.5, ageHours: 6, category: "crypto", relevance: 0.6, publishers: 2 })).toBeCloseTo(0.5 * 0.5 * 0.6 * 1.25);
  });

  it("index is the weighted mean sentiment, null without articles", () => {
    expect(newsIndex([])).toBeNull();
    const r = newsIndex([{ weight: 3, sentiment: 0.5 }, { weight: 1, sentiment: -0.5 }]);
    expect(r?.score).toBeCloseTo(0.25);
    expect(r?.weightSum).toBe(4);
  });

  it("every catalog symbol has at least one alias", () => {
    expect(ASSET_CATALOG.filter((a) => !NEWS_ALIASES[a.symbol]?.length).map((a) => a.symbol)).toEqual([]);
  });
});
