import { NextResponse } from "next/server";
import { findAsset } from "@/lib/assetCatalog";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────
interface NewsItem {
  id: number;
  time: string;
  source: string;
  headline: string;
  sentiment: "bullish" | "bearish" | "neutral";
  tags: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function guessSentiment(title: string): "bullish" | "bearish" | "neutral" {
  const lower = title.toLowerCase();
  const bull = ["surge", "rally", "gain", "rise", "bull", "high", "record", "all-time", "jump", "soar", "up", "boost", "recover", "breakout"];
  const bear = ["drop", "fall", "crash", "bear", "low", "down", "loss", "plunge", "slump", "sell", "fear", "decline", "tumble", "risk"];
  const bScore = bull.filter((w) => lower.includes(w)).length;
  const rScore = bear.filter((w) => lower.includes(w)).length;
  if (bScore > rScore) return "bullish";
  if (rScore > bScore) return "bearish";
  return "neutral";
}

// ─── newsapi.org ──────────────────────────────────────────────────────────────
async function fetchNewsApi(keyword: string, newsApiKey: string): Promise<NewsItem[]> {
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&sortBy=publishedAt&pageSize=12&language=en&apiKey=${newsApiKey}`;
  const res = await fetch(url, { next: { revalidate: 600 } }); // 10 min cache
  if (!res.ok) throw new Error(`NewsAPI ${res.status}`);
  const json = await res.json();
  if (json.status !== "ok") throw new Error(`NewsAPI error: ${json.message}`);

  return (json.articles as any[]).map((a, i) => ({
    id: i + 1,
    time: relativeTime(a.publishedAt),
    source: a.source?.name ?? "Unknown",
    headline: a.title,
    sentiment: guessSentiment(a.title),
    tags: [],
  }));
}

// ─── Yahoo Finance RSS (free fallback) ────────────────────────────────────────
async function fetchYahooRss(yahooSymbol: string): Promise<NewsItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSymbol)}&region=US&lang=en-US`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`Yahoo RSS ${res.status}`);
  const xml = await res.text();

  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  let id = 1;

  while ((match = itemRegex.exec(xml)) !== null && id <= 12) {
    const block = match[1];
    const title = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? "";
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    const source = block.match(/<dc:creator>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/dc:creator>/)?.[1]?.trim() ??
                   block.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() ?? "Yahoo Finance";

    if (title && title !== "Yahoo Finance") {
      items.push({
        id: id++,
        time: pubDate ? relativeTime(new Date(pubDate).toISOString()) : "recent",
        source,
        headline: title,
        sentiment: guessSentiment(title),
        tags: [],
      });
    }
  }
  return items;
}

// ─── CryptoPanic (crypto only) ────────────────────────────────────────────────
async function fetchCryptoPanic(cryptoCode: string, key: string): Promise<NewsItem[]> {
  const res = await fetch(
    `https://cryptopanic.com/api/v1/posts/?auth_token=${key}&currencies=${cryptoCode}&public=true&kind=news`,
    { next: { revalidate: 120 } }
  );
  if (!res.ok) throw new Error(`CryptoPanic ${res.status}`);
  const json = await res.json();

  return (json.results as any[]).slice(0, 12).map((p, i) => {
    const pos = p.votes?.positive ?? 0;
    const neg = p.votes?.negative ?? 0;
    return {
      id: i + 1,
      time: relativeTime(p.published_at),
      source: p.source?.title ?? "Unknown",
      headline: p.title,
      sentiment: pos > neg ? "bullish" : neg > pos ? "bearish" : "neutral",
      tags: (p.currencies ?? []).slice(0, 3).map((c: any) => c.code),
    };
  });
}

// ─── Mock fallback ────────────────────────────────────────────────────────────
function getMockNews(symbol: string): NewsItem[] {
  return [
    { id: 1, time: "5m ago", source: "MarketWatch", headline: `${symbol} sees increased trading activity as markets digest economic data`, sentiment: "neutral", tags: [] },
    { id: 2, time: "23m ago", source: "Bloomberg", headline: `Analysts weigh in on ${symbol} outlook ahead of key data releases`, sentiment: "bullish", tags: [] },
    { id: 3, time: "1h ago", source: "Reuters", headline: `${symbol} volatility rises amid shifting macro sentiment`, sentiment: "neutral", tags: [] },
    { id: 4, time: "2h ago", source: "CNBC", headline: `Technical levels to watch for ${symbol} in today's session`, sentiment: "neutral", tags: [] },
    { id: 5, time: "3h ago", source: "FT", headline: `Institutional flows continue to influence ${symbol} price action`, sentiment: "bullish", tags: [] },
  ];
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "";

  const asset = findAsset(symbol);
  const newsApiKey = process.env.NEWS_API_KEY;
  const cryptoPanicKey = process.env.CRYPTOPANIC_KEY;

  // 1. Try newsapi.org (best coverage for all asset types)
  if (newsApiKey && asset) {
    try {
      const items = await fetchNewsApi(asset.newsKeyword, newsApiKey);
      if (items.length > 0) return NextResponse.json({ items, source: "newsapi" });
    } catch (err) {
      console.error("[news] newsapi.org failed:", err);
    }
  }

  // 2. For crypto: try CryptoPanic
  if (asset?.category === "crypto" && cryptoPanicKey) {
    try {
      const code = symbol.split("/")[0]; // "BTC" from "BTC/USDT"
      const items = await fetchCryptoPanic(code, cryptoPanicKey);
      if (items.length > 0) return NextResponse.json({ items, source: "cryptopanic" });
    } catch (err) {
      console.error("[news] CryptoPanic failed:", err);
    }
  }

  // 3. For tradfi: try Yahoo Finance RSS
  if (asset?.yahooSymbol) {
    try {
      const items = await fetchYahooRss(asset.yahooSymbol);
      if (items.length > 0) return NextResponse.json({ items, source: "yahoo" });
    } catch (err) {
      console.error("[news] Yahoo RSS failed:", err);
    }
  }

  // 4. Final fallback: mock news
  return NextResponse.json({ items: getMockNews(symbol || "this asset"), source: "mock" });
}
