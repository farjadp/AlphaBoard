/**
 * News providers → RawArticle. Parsing is separate from fetching so the shapes are unit-tested.
 * Keys travel in headers where the provider allows it; errors only ever name the host (lib/market/http).
 */
import type { Asset } from "@/lib/assetCatalog";
import { findAsset } from "@/lib/assetCatalog";
import { fetchJson } from "@/lib/market/http";
import { RELEVANCE } from "./match";

export type ProviderId = "finnhub" | "rss" | "yahoo" | "alphavantage" | "marketaux" | "newsapi" | "cryptopanic";

export interface RawArticle {
  provider: ProviderId;
  url: string;
  title: string;
  summary: string | null;
  publisher: string;
  publishedAt: Date;
  /** −1…+1 when the provider scores sentiment (or CryptoPanic votes). */
  sentiment: number | null;
  sentimentSource: "provider" | "votes" | null;
  tags: Array<{ symbol: string; relevance: number; sentiment: number | null }>;
}

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  envKey: string | null;
  enabled(): boolean;
  /** Calls per UTC day we allow ourselves (below the free limit); null = no daily limit. */
  dailyBudget: number | null;
  minIntervalMs: number;
  /** Per-symbol providers query one symbol per call, rotating through the targets. */
  perSymbol: boolean;
  /** Per-symbol calls per run (Yahoo has no key, so a few). */
  callsPerRun?: number;
  supports?(asset: Asset): boolean;
  fetch(asset: Asset | null): Promise<RawArticle[]>;
}

const MIN = 60_000;
const num = (v: unknown) => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };
const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));
const base = (a: Asset) => a.symbol.split("/")[0];
const cryptoBySymbol = (code: string) => findAsset(`${code.toUpperCase()}/USDT`)?.symbol ?? null;
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#039;|&rsquo;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (AlphaBoard news reader)" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.text();
}

// ─── RSS (CoinDesk, Cointelegraph, Decrypt, Yahoo) ───────────────────────────

export function parseRss(xml: string, provider: ProviderId, fallbackPublisher: string): RawArticle[] {
  const out: RawArticle[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const pick = (tag: string) => b.match(new RegExp(`<${tag}\\b[^>]*>(?:\\s*<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>\\s*)?</${tag}>`))?.[1]?.trim();
    const title = pick("title");
    const url = pick("link");
    const at = date(pick("pubDate"));
    if (!title || !url || !at || title === "Yahoo Finance") continue;
    const desc = pick("description");
    out.push({
      provider, url, title: stripHtml(title), summary: desc ? stripHtml(desc).slice(0, 600) || null : null,
      publisher: pick("source") ?? fallbackPublisher, publishedAt: at, sentiment: null, sentimentSource: null, tags: [],
    });
  }
  return out;
}

const FEEDS: Array<[string, string]> = [
  ["https://www.coindesk.com/arc/outboundfeeds/rss/", "CoinDesk"],
  ["https://cointelegraph.com/rss", "Cointelegraph"],
  ["https://decrypt.co/feed", "Decrypt"],
];

// ─── Finnhub ─────────────────────────────────────────────────────────────────

export function parseFinnhub(rows: unknown): RawArticle[] {
  if (!Array.isArray(rows)) throw new Error("finnhub: unexpected response");
  return rows.flatMap((r: Record<string, unknown>) => {
    const at = typeof r.datetime === "number" ? new Date(r.datetime * 1000) : null;
    if (!r.headline || !r.url || !at) return [];
    return [{ provider: "finnhub" as const, url: String(r.url), title: String(r.headline), summary: r.summary ? String(r.summary).slice(0, 600) : null,
      publisher: String(r.source || "Finnhub"), publishedAt: at, sentiment: null, sentimentSource: null, tags: [] }];
  });
}

// ─── Alpha Vantage ───────────────────────────────────────────────────────────

/** "20260928T225036" (UTC) → Date */
const avTime = (s: unknown) => {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))) : null;
};

export function parseAlphaVantage(j: unknown): RawArticle[] {
  const o = j as { feed?: unknown[]; Information?: string; Note?: string; "Error Message"?: string };
  if (!Array.isArray(o?.feed)) throw new Error(`alphavantage: ${o?.Information ?? o?.Note ?? o?.["Error Message"] ?? "unexpected response"}`.slice(0, 160));
  return o.feed.flatMap((f) => {
    const r = f as Record<string, unknown>;
    const at = avTime(r.time_published);
    if (!r.title || !r.url || !at) return [];
    const overall = num(r.overall_sentiment_score);
    const tags = (Array.isArray(r.ticker_sentiment) ? r.ticker_sentiment : []).flatMap((t: Record<string, unknown>) => {
      const code = String(t.ticker ?? "").match(/^CRYPTO:([A-Z0-9]+)$/)?.[1];
      const symbol = code ? cryptoBySymbol(code) : null;
      const s = num(t.ticker_sentiment_score);
      return symbol ? [{ symbol, relevance: RELEVANCE.tagged, sentiment: s == null ? null : clamp1(s) }] : [];
    });
    return [{ provider: "alphavantage" as const, url: String(r.url), title: String(r.title), summary: r.summary ? String(r.summary).slice(0, 600) : null,
      publisher: String(r.source || r.source_domain || "Unknown"), publishedAt: at,
      sentiment: overall == null ? null : clamp1(overall), sentimentSource: overall == null ? null : "provider" as const, tags }];
  });
}

// ─── Marketaux ───────────────────────────────────────────────────────────────

export function parseMarketaux(j: unknown, queried: string | null): RawArticle[] {
  const o = j as { data?: unknown[]; error?: { message?: string } };
  if (!Array.isArray(o?.data)) throw new Error(`marketaux: ${o?.error?.message ?? "unexpected response"}`.slice(0, 160));
  return o.data.flatMap((d) => {
    const r = d as Record<string, unknown>;
    const at = date(r.published_at);
    if (!r.title || !r.url || !at) return [];
    const scores = (Array.isArray(r.entities) ? r.entities : []).map((e: Record<string, unknown>) => num(e.sentiment_score)).filter((n): n is number => n != null);
    const s = scores.length ? clamp1(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    return [{ provider: "marketaux" as const, url: String(r.url), title: String(r.title), summary: r.description ? String(r.description).slice(0, 600) : null,
      publisher: String(r.source || "Unknown"), publishedAt: at, sentiment: s, sentimentSource: s == null ? null : "provider" as const,
      tags: queried ? [{ symbol: queried, relevance: RELEVANCE.title, sentiment: null }] : [] }];
  });
}

const marketauxTerm = (a: Asset) => (a.category === "forex" ? `"${a.symbol}"` : `"${a.name}"`);

// ─── NewsAPI ─────────────────────────────────────────────────────────────────

export function parseNewsApi(j: unknown, queried: string | null): RawArticle[] {
  const o = j as { status?: string; message?: string; articles?: unknown[] };
  if (o?.status !== "ok" || !Array.isArray(o.articles)) throw new Error(`newsapi: ${o?.message ?? o?.status ?? "unexpected response"}`.slice(0, 160));
  return o.articles.flatMap((x) => {
    const r = x as { title?: string; url?: string; publishedAt?: string; description?: string; source?: { name?: string } };
    const at = date(r.publishedAt);
    if (!r.title || r.title === "[Removed]" || !r.url || !at) return [];
    return [{ provider: "newsapi" as const, url: r.url, title: r.title, summary: r.description?.slice(0, 600) ?? null, publisher: r.source?.name ?? "Unknown",
      publishedAt: at, sentiment: null, sentimentSource: null, tags: queried ? [{ symbol: queried, relevance: RELEVANCE.title, sentiment: null }] : [] }];
  });
}

// ─── CryptoPanic (paid plans only) ───────────────────────────────────────────

const CRYPTOPANIC_PLANS = ["developer", "growth", "enterprise"] as const;

/** v2 puts the plan in the path: /api/<plan>/v2/posts/. */
export function cryptoPanicUrl(code: string, key: string, plan = process.env.CRYPTOPANIC_PLAN): string {
  const p = (plan ?? "").trim().toLowerCase() || "developer";
  if (!(CRYPTOPANIC_PLANS as readonly string[]).includes(p)) throw new Error(`CRYPTOPANIC_PLAN must be one of ${CRYPTOPANIC_PLANS.join(", ")}`);
  const q = new URLSearchParams({ auth_token: key, currencies: code, public: "true", kind: "news" });
  return `https://cryptopanic.com/api/${p}/v2/posts/?${q}`;
}

export function parseCryptoPanic(j: unknown): RawArticle[] {
  const o = j as { results?: unknown[] };
  if (!Array.isArray(o?.results)) throw new Error("cryptopanic: unexpected response");
  return o.results.flatMap((x) => {
    const r = x as { title?: string; url?: string; original_url?: string; published_at?: string; description?: string; source?: { title?: string }; votes?: { positive?: number; negative?: number }; currencies?: Array<{ code: string }> };
    const url = r.original_url ?? r.url;
    const at = date(r.published_at);
    if (!r.title || !url || !at) return [];
    const pos = r.votes?.positive ?? 0, neg = r.votes?.negative ?? 0;
    const s = pos + neg >= 3 ? clamp1((pos - neg) / (pos + neg)) : null;
    const tags = (r.currencies ?? []).flatMap((c) => { const symbol = cryptoBySymbol(c.code); return symbol ? [{ symbol, relevance: RELEVANCE.tagged, sentiment: null }] : []; });
    return [{ provider: "cryptopanic" as const, url, title: r.title, summary: r.description?.slice(0, 600) ?? null, publisher: r.source?.title ?? "CryptoPanic",
      publishedAt: at, sentiment: s, sentimentSource: s == null ? null : "votes" as const, tags }];
  });
}

// ─── Registry ────────────────────────────────────────────────────────────────

const key = (name: string) => process.env[name]?.trim() || "";

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "finnhub", label: "Finnhub", envKey: "FINNHUB_KEY", enabled: () => !!key("FINNHUB_KEY"),
    dailyBudget: null, minIntervalMs: 10 * MIN, perSymbol: false,
    async fetch() {
      const lists = await Promise.all(["crypto", "general", "forex"].map((c) =>
        fetchJson<unknown>(`https://finnhub.io/api/v1/news?category=${c}`, { headers: { "X-Finnhub-Token": key("FINNHUB_KEY") } }).then(parseFinnhub)));
      return lists.flat();
    },
  },
  {
    id: "rss", label: "RSS (CoinDesk, Cointelegraph, Decrypt)", envKey: null, enabled: () => true,
    dailyBudget: null, minIntervalMs: 10 * MIN, perSymbol: false,
    async fetch() {
      const lists = await Promise.allSettled(FEEDS.map(async ([url, name]) => parseRss(await fetchText(url), "rss", name)));
      const ok = lists.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (!ok.length && lists.some((r) => r.status === "rejected")) throw (lists.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
      return ok;
    },
  },
  {
    id: "yahoo", label: "Yahoo Finance RSS", envKey: null, enabled: () => true,
    dailyBudget: null, minIntervalMs: 10 * MIN, perSymbol: true, callsPerRun: 3,
    async fetch(asset) {
      if (!asset) return [];
      const s = asset.yahooSymbol ?? `${base(asset)}-USD`;
      const items = parseRss(await fetchText(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(s)}&region=US&lang=en-US`), "yahoo", "Yahoo Finance");
      // Yahoo's per-symbol feed is loose (mining stocks under gold, politics under BTC): title-level relevance, not "tagged".
      return items.map((i) => ({ ...i, tags: [{ symbol: asset.symbol, relevance: RELEVANCE.title, sentiment: null }] }));
    },
  },
  {
    id: "alphavantage", label: "Alpha Vantage", envKey: "ALPHAVANTAGE_KEY", enabled: () => !!key("ALPHAVANTAGE_KEY"),
    dailyBudget: 24, minIntervalMs: 55 * MIN, perSymbol: true, supports: (a) => a.category === "crypto",
    async fetch(asset) {
      if (!asset) return [];
      const q = new URLSearchParams({ function: "NEWS_SENTIMENT", tickers: `CRYPTO:${base(asset)}`, sort: "LATEST", limit: "50", apikey: key("ALPHAVANTAGE_KEY") });
      return parseAlphaVantage(await fetchJson<unknown>(`https://www.alphavantage.co/query?${q}`));
    },
  },
  {
    id: "marketaux", label: "Marketaux", envKey: "MARKETAUX_KEY", enabled: () => !!key("MARKETAUX_KEY"),
    dailyBudget: 90, minIntervalMs: 15 * MIN, perSymbol: true,
    async fetch(asset) {
      if (!asset) return [];
      const q = new URLSearchParams({ search: marketauxTerm(asset), language: "en", limit: "3", api_token: key("MARKETAUX_KEY") });
      return parseMarketaux(await fetchJson<unknown>(`https://api.marketaux.com/v1/news/all?${q}`), asset.symbol);
    },
  },
  {
    id: "newsapi", label: "NewsAPI", envKey: "NEWS_API_KEY", enabled: () => !!key("NEWS_API_KEY"),
    dailyBudget: 70, minIntervalMs: 20 * MIN, perSymbol: true,
    async fetch(asset) {
      if (!asset) return [];
      const q = new URLSearchParams({ q: asset.newsKeyword, sortBy: "publishedAt", pageSize: "20", language: "en" });
      return parseNewsApi(await fetchJson<unknown>(`https://newsapi.org/v2/everything?${q}`, { headers: { "X-Api-Key": key("NEWS_API_KEY") } }), asset.symbol);
    },
  },
  {
    id: "cryptopanic", label: "CryptoPanic", envKey: "CRYPTOPANIC_KEY", enabled: () => !!key("CRYPTOPANIC_KEY"),
    dailyBudget: 90, minIntervalMs: 15 * MIN, perSymbol: true, supports: (a) => a.category === "crypto",
    async fetch(asset) {
      if (!asset) return [];
      return parseCryptoPanic(await fetchJson<unknown>(cryptoPanicUrl(base(asset), key("CRYPTOPANIC_KEY"))));
    },
  },
];
