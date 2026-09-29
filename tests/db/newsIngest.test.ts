import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { PROVIDER_STATE_KEY, readProviderStates, runIngest, storeArticles } from "@/lib/news/ingest";
import type { ProviderSpec, RawArticle } from "@/lib/news/sources";

const run = !!process.env.TEST_DATABASE_URL;
const now = new Date("2026-09-29T12:00:00Z");
const art = (o: Partial<RawArticle>): RawArticle => ({
  provider: "rss", url: "https://coindesk.com/a", title: "Bitcoin rallies past resistance", summary: null, publisher: "CoinDesk",
  publishedAt: new Date("2026-09-29T11:00:00Z"), sentiment: null, sentimentSource: null, tags: [], ...o,
});

describe.skipIf(!run)("news ingest (Postgres)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "NewsArticle", "NewsPublisher", "NewsIndexSnapshot", "NewsWeightRun", "PublisherWeightChange" CASCADE`);
    await prisma.appSetting.deleteMany({ where: { key: PROVIDER_STATE_KEY } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("stores matched articles with keyword sentiment and skips ones naming no symbol, too old, or from the future", async () => {
    const r = await storeArticles([
      art({}),
      art({ url: "https://x.com/none", title: "Central bank speeches this week" }),
      art({ url: "https://x.com/old", publishedAt: new Date("2026-09-10T00:00:00Z") }),
      art({ url: "https://x.com/future", publishedAt: new Date("2026-09-29T15:00:00Z") }),
    ], now);
    expect(r).toEqual({ stored: 1, merged: 0 });
    const a = await prisma.newsArticle.findFirstOrThrow({ include: { symbols: true, publisher: true } });
    expect(a.sentimentSource).toBe("keywords");
    expect(a.sentiment).toBeGreaterThan(0);
    expect(a.publisher).toMatchObject({ key: "coindesk", name: "CoinDesk", weight: 0.5 });
    expect(a.symbols).toMatchObject([{ symbol: "BTC/USDT", relevance: 0.6 }]);
  });

  it("merges the same story from a second provider: adds the provider, the tag and the better sentiment", async () => {
    await storeArticles([art({ url: "https://coindesk.com/a?utm=1" })], now);
    const r = await storeArticles([art({ provider: "alphavantage", url: "https://www.coindesk.com/a/", sentiment: 0.4, sentimentSource: "provider",
      tags: [{ symbol: "BTC/USDT", relevance: 1, sentiment: 0.5 }, { symbol: "ETH/USDT", relevance: 1, sentiment: -0.2 }] })], now);
    expect(r).toEqual({ stored: 0, merged: 1 });
    const a = await prisma.newsArticle.findFirstOrThrow({ include: { symbols: { orderBy: { symbol: "asc" } } } });
    expect(a.providers.sort()).toEqual(["alphavantage", "rss"]);
    expect(a).toMatchObject({ sentiment: 0.4, sentimentSource: "provider" });
    expect(a.symbols).toMatchObject([{ symbol: "BTC/USDT", relevance: 1, sentiment: 0.5 }, { symbol: "ETH/USDT", relevance: 1, sentiment: -0.2 }]);
  });

  it("merges by title within 48 h when the URL differs", async () => {
    await storeArticles([art({})], now);
    const r = await storeArticles([art({ provider: "finnhub", url: "https://finnhub.io/api/news?id=9", title: "Bitcoin Rallies Past Resistance!" })], now);
    expect(r.merged).toBe(1);
    expect(await prisma.newsArticle.count()).toBe(1);
  });

  it("respects interval and daily budget, rotates per-symbol providers and records errors", async () => {
    const seen: string[] = [];
    const perSymbol: ProviderSpec = {
      id: "marketaux", label: "M", envKey: null, enabled: () => true, dailyBudget: 2, minIntervalMs: 15 * 60_000, perSymbol: true,
      async fetch(a) { seen.push(a!.symbol); if (a!.symbol === "ETH/USDT") throw new Error("api.marketaux.com responded 429"); return [art({ provider: "marketaux", url: `https://m.com/${a!.symbol}`, tags: [{ symbol: a!.symbol, relevance: 0.6, sentiment: null }] })]; },
    };
    const targets = [findAsset("BTC/USDT")!, findAsset("ETH/USDT")!];
    await runIngest({ now, providers: [perSymbol], targets });
    await runIngest({ now: new Date(now.getTime() + 5 * 60_000), providers: [perSymbol], targets }); // too soon
    await runIngest({ now: new Date(now.getTime() + 16 * 60_000), providers: [perSymbol], targets });
    await runIngest({ now: new Date(now.getTime() + 32 * 60_000), providers: [perSymbol], targets }); // budget spent
    expect(seen).toEqual(["BTC/USDT", "ETH/USDT"]);
    const st = (await readProviderStates()).marketaux!;
    expect(st).toMatchObject({ count: 2, rotation: 2, lastError: "api.marketaux.com responded 429" });
    expect(await prisma.newsArticle.count()).toBe(1);
  });
});
