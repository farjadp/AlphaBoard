import { describe, expect, it } from "vitest";
import { cryptoPanicUrl, parseAlphaVantage, parseCryptoPanic, parseFinnhub, parseMarketaux, parseNewsApi, parseRss } from "@/lib/news/sources";

describe("news source parsers (shapes seen 2026-09-29)", () => {
  it("Finnhub: unix seconds, no tags", () => {
    const [a] = parseFinnhub([{ category: "crypto", datetime: 1790654549, headline: "Coinbase gets CFTC approval", id: 1, related: "", source: "Cointelegraph", summary: "S", url: "https://cointelegraph.com/news/x" }, { headline: "no url" }]);
    expect(a).toMatchObject({ provider: "finnhub", publisher: "Cointelegraph", title: "Coinbase gets CFTC approval", tags: [], sentiment: null });
    expect(a.publishedAt.toISOString()).toBe("2026-09-29T04:02:29.000Z");
    expect(() => parseFinnhub({ error: "x" })).toThrow();
  });

  it("Alpha Vantage: UTC compact time, overall + per-crypto-ticker sentiment; rate-limit note throws", () => {
    const [a] = parseAlphaVantage({ items: "1", feed: [{ title: "BTC up", url: "https://x.com/a", time_published: "20260928T225036", source: "Kalkine Media", summary: "s", overall_sentiment_score: 0.21,
      ticker_sentiment: [{ ticker: "CRYPTO:BTC", relevance_score: "0.9", ticker_sentiment_score: "0.4" }, { ticker: "COIN", ticker_sentiment_score: "0.1" }, { ticker: "CRYPTO:ZZZ", ticker_sentiment_score: "0.1" }] }] });
    expect(a.publishedAt.toISOString()).toBe("2026-09-28T22:50:36.000Z");
    expect(a).toMatchObject({ sentiment: 0.21, sentimentSource: "provider", publisher: "Kalkine Media", tags: [{ symbol: "BTC/USDT", relevance: 1, sentiment: 0.4 }] });
    expect(() => parseAlphaVantage({ Information: "rate limit" })).toThrow(/rate limit/);
  });

  it("Marketaux: mean entity sentiment, queried symbol tagged at title relevance", () => {
    const [a] = parseMarketaux({ data: [{ title: "Gold rises", url: "https://y.com/b", published_at: "2026-09-29T01:04:40.000000Z", source: "insidermonkey.com", description: "d", entities: [{ sentiment_score: 0.4 }, { sentiment_score: 0.2 }] }] }, "XAU/USD");
    expect(a.sentiment).toBeCloseTo(0.3);
    expect(a.tags).toEqual([{ symbol: "XAU/USD", relevance: 0.6, sentiment: null }]);
    expect(() => parseMarketaux({ error: { message: "usage limit" } }, null)).toThrow(/usage limit/);
  });

  it("NewsAPI: drops [Removed]; error status throws", () => {
    expect(parseNewsApi({ status: "ok", articles: [{ title: "[Removed]", url: "u", publishedAt: "2026-09-29T00:00:00Z" }, { title: "T", url: "https://z.com/c", publishedAt: "2026-09-29T00:00:00Z", source: { name: "Reuters" } }] }, "SPX")).toHaveLength(1);
    expect(() => parseNewsApi({ status: "error", message: "apiKeyInvalid" }, null)).toThrow(/apiKeyInvalid/);
  });

  it("CryptoPanic: prefers original_url, votes need ≥3 to count, currencies map to catalog", () => {
    const [a, b] = parseCryptoPanic({ results: [
      { title: "A", url: "https://cryptopanic.com/news/1", original_url: "https://coindesk.com/a", published_at: "2026-09-29T00:00:00Z", source: { title: "CoinDesk" }, votes: { positive: 3, negative: 1 }, currencies: [{ code: "ETH" }, { code: "ZZZ" }] },
      { title: "B", url: "https://cryptopanic.com/news/2", published_at: "2026-09-29T00:00:00Z", votes: { positive: 1, negative: 0 } },
    ] });
    expect(a).toMatchObject({ url: "https://coindesk.com/a", sentiment: 0.5, sentimentSource: "votes", tags: [{ symbol: "ETH/USDT", relevance: 1, sentiment: null }] });
    expect(b.sentiment).toBeNull();
  });

  it("CryptoPanic v2 URL carries the plan; unknown plans are refused", () => {
    const u = new URL(cryptoPanicUrl("BTC", "k1", undefined));
    expect(u.pathname).toBe("/api/developer/v2/posts/");
    expect(u.searchParams.get("currencies")).toBe("BTC");
    expect(new URL(cryptoPanicUrl("BTC", "k", " Growth ")).pathname).toBe("/api/growth/v2/posts/");
    expect(() => cryptoPanicUrl("BTC", "k", "free")).toThrow(/CRYPTOPANIC_PLAN/);
  });

  it("RSS: CDATA titles, HTML stripped from descriptions, bad items skipped", () => {
    const xml = `<rss><channel><item><title><![CDATA[Ether &amp; SOL rally]]></title><link>https://decrypt.co/1</link><pubDate>Mon, 29 Sep 2026 01:00:00 +0000</pubDate><description><![CDATA[<p>Hello <b>world</b></p>]]></description></item><item><title>No date</title><link>https://decrypt.co/2</link></item></channel></rss>`;
    const items = parseRss(xml, "rss", "Decrypt");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Ether & SOL rally", summary: "Hello world", publisher: "Decrypt" });
  });
});
