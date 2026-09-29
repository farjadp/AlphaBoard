import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { storeArticles } from "@/lib/news/ingest";
import { rankedNews } from "@/lib/news/read";
import { evaluatePending, indexReport, publisherReport, snapshotIndex } from "@/lib/news/measure";
import { guardWeight, revertWeightChange, runWeightAgent, setPublisherWeight, WEIGHTS_LAST_KEY } from "@/lib/news/weights";
import { runNewsJob } from "@/lib/news/job";
import type { RawArticle } from "@/lib/news/sources";
import type { aiJson } from "@/lib/ai";

const run = !!process.env.TEST_DATABASE_URL;
const H = 3_600_000;
const t0 = Date.UTC(2026, 8, 20, 0);
const art = (i: number, o: Partial<RawArticle> = {}): RawArticle => ({
  provider: "rss", url: `https://coindesk.com/${i}`, title: `Bitcoin rallies again story ${i}`, summary: null, publisher: "CoinDesk",
  publishedAt: new Date(t0 + i * H), sentiment: 0.5, sentimentSource: "provider", tags: [], ...o,
});
/** BTC rises 1 per hour from 100. */
const risingBars = async () => Array.from({ length: 24 * 12 }, (_, i) => ({ time: t0 - 24 * H + i * H, open: 100 + i }));

describe.skipIf(!run)("news measurement and weights (Postgres)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "NewsArticle", "NewsPublisher", "NewsIndexSnapshot", "NewsWeightRun", "PublisherWeightChange", "User" CASCADE`);
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: "news." } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("ranks by publisher weight × recency × relevance and snapshots the weighted index once per hour", async () => {
    const now = new Date(t0 + 30 * H);
    await storeArticles([
      art(29, { url: "https://a.com/1", title: "Bitcoin climbs on ETF demand", publisher: "Reuters", sentiment: 0.6 }),
      art(29, { url: "https://b.com/2", title: "Bitcoin slides as miners sell", publisher: "Blog", sentiment: -0.6 }),
    ], now);
    await prisma.newsPublisher.update({ where: { key: "reuters" }, data: { weight: 1 } });
    await prisma.newsPublisher.update({ where: { key: "blog" }, data: { weight: 0.1 } });
    const r = await rankedNews("BTC/USDT", { now });
    expect(r.map((x) => x.publisher)).toEqual(["Reuters", "Blog"]);
    expect(await snapshotIndex([findAsset("BTC/USDT")!], now)).toBe(1);
    expect(await snapshotIndex([findAsset("BTC/USDT")!], new Date(now.getTime() + 10 * 60_000))).toBe(0);
    const s = await prisma.newsIndexSnapshot.findFirstOrThrow();
    expect(s.score).toBeCloseTo((1 * 0.6 + 0.1 * -0.6) / 1.1);
    expect(s).toMatchObject({ articles: 2, publishers: 2, at: new Date(t0 + 30 * H) });
  });

  it("fills 4 h / 24 h returns from 1H bars once 24 h have passed, and reports publisher accuracy", async () => {
    await storeArticles([art(0), art(1, { url: "https://coindesk.com/b", title: "Bitcoin plunges hard", sentiment: -0.5 })], new Date(t0 + 2 * H));
    expect((await evaluatePending(new Date(t0 + 20 * H), risingBars)).links).toBe(0); // not ripe
    const e = await evaluatePending(new Date(t0 + 30 * H), risingBars);
    expect(e.links).toBe(2);
    const link = await prisma.newsArticleSymbol.findFirstOrThrow({ where: { article: { urlKey: "https://coindesk.com/0" } } });
    expect(link.ret4h).toBeCloseTo(128 / 124 - 1);
    expect(link.ret24h).toBeCloseTo(148 / 124 - 1);
    const rep = await publisherReport(new Date(t0 + 30 * H));
    expect(rep.publishers[0]).toMatchObject({ key: "coindesk", window: { calls: 2, hitRate24h: 0.5 } });
  });

  it("weights agent: skipped without 20 calls; otherwise applies within the code limits and logs reason + evidence", async () => {
    const now = new Date(t0 + 40 * 24 * H);
    await storeArticles(Array.from({ length: 1 }, (_, i) => art(i)), new Date(t0 + H));
    const skipped = await runWeightAgent({ now: new Date(t0 + 2 * H) });
    expect(await prisma.newsWeightRun.findUniqueOrThrow({ where: { id: skipped! } })).toMatchObject({ status: "skipped" });
    expect(await runWeightAgent({ now: new Date(t0 + 3 * H) })).toBeNull(); // not due for a week

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "NewsArticle", "NewsWeightRun" CASCADE`);
    await prisma.appSetting.deleteMany({ where: { key: WEIGHTS_LAST_KEY } });
    const base = now.getTime() - 20 * 24 * H;
    await storeArticles(Array.from({ length: 25 }, (_, i) => art(i, { publishedAt: new Date(base + i * H) })), new Date(base + 26 * H));
    await prisma.newsArticleSymbol.updateMany({ data: { ret4h: 0.01, ret24h: 0.02, evaluatedAt: now } });
    await prisma.user.create({ data: { email: "admin@test.local", passwordHash: "x", role: "ADMIN" } });

    const fakeAi = (async () => ({
      data: { summary: "CoinDesk calls were right every time.", changes: [{ publisher: "coindesk", weight: 0.95, reason: "25/25 hits at 24 h vs baseline" }, { publisher: "nobody", weight: 1, reason: "x" }] },
      meta: { provider: "openai", model: "gpt-5.4-mini", inputTokens: 1, outputTokens: 1, costUsd: 0.001, visionFallback: false },
    })) as unknown as typeof aiJson;
    const id = await runWeightAgent({ now, ai: fakeAi });
    const r = await prisma.newsWeightRun.findUniqueOrThrow({ where: { id: id! }, include: { changes: true } });
    expect(r).toMatchObject({ status: "ok", model: "openai/gpt-5.4-mini", skipped: [{ publisher: "nobody" }] });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ publisherKey: "coindesk", by: "agent", from: 0.5, proposed: 0.95, to: 0.7, clamped: true, reason: "25/25 hits at 24 h vs baseline" });
    expect((r.changes[0].evidence as { window30d: { calls: number } }).window30d.calls).toBe(25);
    expect((await prisma.newsPublisher.findUniqueOrThrow({ where: { key: "coindesk" } })).weight).toBe(0.7);

    const admin = await prisma.user.findFirstOrThrow();
    await revertWeightChange(r.changes[0].id, admin.id);
    expect((await prisma.newsPublisher.findUniqueOrThrow({ where: { key: "coindesk" } })).weight).toBe(0.5);
    await expect(revertWeightChange(r.changes[0].id, admin.id)).rejects.toThrow(/Already reverted/);
    await setPublisherWeight("coindesk", 0.9, admin.id, "manual");
    await expect(setPublisherWeight("coindesk", 1.5, admin.id, "x")).rejects.toThrow(/between/);
    expect(await prisma.publisherWeightChange.count()).toBe(3);
  });

  it("guardWeight clamps to the range and the weekly step", () => {
    expect(guardWeight(0.5, 0.95)).toEqual({ to: 0.7, clamped: true });
    expect(guardWeight(0.2, 0)).toEqual({ to: 0.1, clamped: true });
    expect(guardWeight(0.5, 0.6)).toEqual({ to: 0.6, clamped: false });
  });

  it("the job runs every part and records its result even when a part fails", async () => {
    const r = await runNewsJob({ now: new Date(t0 + 30 * H), providers: [], barsOf: async () => { throw new Error("no candles"); } });
    expect(r.errors).toEqual([]);
    const last = await prisma.appSetting.findUniqueOrThrow({ where: { key: "news.last" } });
    expect((last.value as { at: string }).at).toBe(new Date(t0 + 30 * H).toISOString());
    expect((await indexReport(new Date(t0 + 30 * H))).symbols).toEqual([]);
  });
});
