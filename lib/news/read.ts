import "server-only";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { articleWeight, corroboration } from "./score";
import type { SentimentSource } from "./text";

export interface RankedArticle {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publisherKey: string;
  publishedAt: Date;
  /** −1…+1: the provider's per-symbol score when present, else the article's. */
  sentiment: number;
  sentimentSource: SentimentSource;
  relevance: number;
  publishers: number;
  weight: number;
}

/** A symbol's articles from the last `windowH` hours, heaviest first. */
export async function rankedNews(symbol: string, opts: { now?: Date; windowH?: number } = {}): Promise<RankedArticle[]> {
  const asset = findAsset(symbol);
  if (!asset) return [];
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.windowH ?? 72) * 3_600_000);
  const links = await prisma.newsArticleSymbol.findMany({
    where: { symbol, article: { publishedAt: { gte: since, lte: now } } },
    include: { article: { include: { publisher: { select: { name: true, weight: true } } } } },
    take: 500,
  });
  const k = corroboration(links.map((l) => ({ id: l.articleId, title: l.article.title, publisherKey: l.article.publisherKey })));
  return links.map((l) => {
    const a = l.article;
    const publishers = k.get(a.id) ?? 1;
    return {
      id: a.id, title: a.title, url: a.url, publisher: a.publisher.name, publisherKey: a.publisherKey, publishedAt: a.publishedAt,
      sentiment: l.sentiment ?? a.sentiment,
      sentimentSource: (l.sentiment != null ? "provider" : a.sentimentSource) as SentimentSource,
      relevance: l.relevance, publishers,
      weight: articleWeight({ publisherWeight: a.publisher.weight, ageHours: (now.getTime() - a.publishedAt.getTime()) / 3_600_000, category: asset.category, relevance: l.relevance, publishers }),
    };
  }).sort((x, y) => y.weight - x.weight || y.publishedAt.getTime() - x.publishedAt.getTime());
}
