/**
 * Headlines per asset from the news hub (lib/news): every provider, de-duplicated, heaviest first.
 * When the hub has nothing for a symbol yet (not a target, or before the first ingest), Yahoo's per-symbol
 * feed is fetched, stored in the hub and served. No fabricated fallback: v1 generated fake headlines
 * attributed to Bloomberg/Reuters when every source failed.
 */
import type { Asset } from "@/lib/assetCatalog";
import { logger } from "@/lib/http/logger";
import { marketMemo } from "./cache";
import { storeArticles } from "@/lib/news/ingest";
import { rankedNews } from "@/lib/news/read";
import { PROVIDERS } from "@/lib/news/sources";
import { sentimentLabel, type SentimentLabel, type SentimentSource } from "@/lib/news/text";

export type Sentiment = SentimentLabel;
export interface NewsItem {
  id: string;
  publishedAt: string | null;
  source: string;
  headline: string;
  url: string | null;
  sentiment: Sentiment;
  /** Where the sentiment came from: provider score, CryptoPanic votes, or the keyword heuristic. */
  sentimentSource: SentimentSource;
  tags: string[];
}
export interface NewsResult { items: NewsItem[]; source: "hub" | "none" }

const fromHub = async (symbol: string): Promise<NewsItem[]> =>
  (await rankedNews(symbol)).slice(0, 12).map((a) => ({
    id: a.id, publishedAt: a.publishedAt.toISOString(), source: a.publisher, headline: a.title, url: a.url,
    sentiment: sentimentLabel(a.sentiment), sentimentSource: a.sentimentSource, tags: [],
  }));

export function getNews(asset: Asset): Promise<NewsResult> {
  return marketMemo(`news:${asset.symbol}`, 5 * 60_000, async () => {
    try {
      let items = await fromHub(asset.symbol);
      if (!items.length) {
        const yahoo = PROVIDERS.find((p) => p.id === "yahoo")!;
        await storeArticles(await yahoo.fetch(asset));
        items = await fromHub(asset.symbol);
      }
      return { items, source: items.length ? "hub" : "none" };
    } catch (e) {
      logger.warn({ symbol: asset.symbol, err: e instanceof Error ? e.message : String(e) }, "news unavailable");
      return { items: [], source: "none" };
    }
  });
}
