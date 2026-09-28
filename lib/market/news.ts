/**
 * Headlines per asset: NewsAPI → CryptoPanic (crypto) → Yahoo RSS. No fabricated fallback:
 * v1 generated fake headlines attributed to Bloomberg/Reuters when every source failed.
 */
import type { Asset } from "@/lib/assetCatalog";
import { logger } from "@/lib/http/logger";
import { marketMemo } from "./cache";
import { fetchJson } from "./http";

export type Sentiment = "bullish" | "bearish" | "neutral";
export interface NewsItem { id: string; publishedAt: string | null; source: string; headline: string; url: string | null; sentiment: Sentiment; tags: string[] }
export interface NewsResult { items: NewsItem[]; source: "newsapi" | "cryptopanic" | "yahoo" | "none" }

const BULL = ["surge", "rally", "gain", "rise", "bull", "record", "all-time high", "jump", "soar", "boost", "recover", "breakout", "inflow"];
const BEAR = ["drop", "fall", "crash", "bear", "plunge", "slump", "sell-off", "selloff", "fear", "decline", "tumble", "outflow", "liquidat"];

/** Keyword heuristic, labelled as such in the UI. Word-boundary match avoids "up" in "update". */
export function guessSentiment(title: string): Sentiment {
  const t = ` ${title.toLowerCase()} `;
  const hit = (w: string) => new RegExp(`\\b${w.replace(/[-]/g, "[- ]?")}`).test(t);
  const b = BULL.filter(hit).length;
  const r = BEAR.filter(hit).length;
  return b > r ? "bullish" : r > b ? "bearish" : "neutral";
}

const iso = (v: unknown) => { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

async function newsApi(keyword: string, key: string): Promise<NewsItem[]> {
  type R = { status: string; message?: string; articles?: Array<{ title?: string; url?: string; publishedAt?: string; source?: { name?: string } }> };
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&sortBy=publishedAt&pageSize=12&language=en`;
  const j = await fetchJson<R>(url, { headers: { "X-Api-Key": key } }); // key in header, never in the URL/logs
  if (j.status !== "ok") throw new Error(`newsapi: ${j.message ?? j.status}`);
  return (j.articles ?? []).filter((a) => a.title && a.title !== "[Removed]").map((a, i) => ({
    id: `na-${i}-${a.publishedAt}`, publishedAt: iso(a.publishedAt), source: a.source?.name ?? "Unknown",
    headline: a.title!, url: a.url ?? null, sentiment: guessSentiment(a.title!), tags: [],
  }));
}

async function cryptoPanic(code: string, key: string): Promise<NewsItem[]> {
  type R = { results?: Array<{ id: number; title: string; url?: string; published_at: string; source?: { title?: string }; votes?: { positive?: number; negative?: number }; currencies?: Array<{ code: string }> }> };
  const j = await fetchJson<R>(`https://cryptopanic.com/api/v1/posts/?auth_token=${key}&currencies=${code}&public=true&kind=news`);
  return (j.results ?? []).slice(0, 12).map((p) => {
    const pos = p.votes?.positive ?? 0, neg = p.votes?.negative ?? 0;
    return {
      id: `cp-${p.id}`, publishedAt: iso(p.published_at), source: p.source?.title ?? "Unknown", headline: p.title, url: p.url ?? null,
      sentiment: pos > neg ? "bullish" : neg > pos ? "bearish" : guessSentiment(p.title),
      tags: (p.currencies ?? []).slice(0, 3).map((c) => c.code),
    };
  });
}

async function yahooRss(symbol: string): Promise<NewsItem[]> {
  const res = await fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!res.ok) throw new Error(`yahoo rss ${res.status}`);
  const xml = await res.text();
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const pick = (tag: string) => b.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1]?.trim();
    const title = pick("title");
    if (!title || title === "Yahoo Finance") continue;
    items.push({ id: `yh-${items.length}`, publishedAt: iso(pick("pubDate")), source: pick("dc:creator") ?? pick("source") ?? "Yahoo Finance", headline: title, url: pick("link") ?? null, sentiment: guessSentiment(title), tags: [] });
    if (items.length >= 12) break;
  }
  return items;
}

export function getNews(asset: Asset): Promise<NewsResult> {
  return marketMemo(`news:${asset.symbol}`, 10 * 60_000, async () => {
    const newsKey = process.env.NEWS_API_KEY;
    const panicKey = process.env.CRYPTOPANIC_KEY;
    const attempts: Array<[NewsResult["source"], () => Promise<NewsItem[]>]> = [];
    if (newsKey) attempts.push(["newsapi", () => newsApi(asset.newsKeyword, newsKey)]);
    if (asset.category === "crypto" && panicKey) attempts.push(["cryptopanic", () => cryptoPanic(asset.symbol.split("/")[0], panicKey)]);
    if (asset.yahooSymbol) attempts.push(["yahoo", () => yahooRss(asset.yahooSymbol!)]);
    else if (asset.category === "crypto") attempts.push(["yahoo", () => yahooRss(`${asset.symbol.split("/")[0]}-USD`)]);

    for (const [source, run] of attempts) {
      try {
        const items = await run();
        if (items.length) return { items, source };
      } catch (e) {
        logger.warn({ symbol: asset.symbol, source, err: e instanceof Error ? e.message : String(e) }, "news source failed");
      }
    }
    return { items: [], source: "none" };
  });
}
