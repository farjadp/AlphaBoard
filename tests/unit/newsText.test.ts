import { describe, expect, it } from "vitest";
import { canonicalUrl, keywordSentiment, publisherKey, sentimentLabel, titleKey } from "@/lib/news/text";
import { matchSymbols } from "@/lib/news/match";

describe("news text helpers", () => {
  it("canonicalUrl drops query, fragment, www and trailing slash; lowercases the host only", () => {
    expect(canonicalUrl("https://WWW.CoinDesk.com/Markets/2026/09/29/btc/?utm_source=x#top")).toBe("https://coindesk.com/Markets/2026/09/29/btc");
    expect(canonicalUrl("not a url")).toBeNull();
  });

  it("titleKey ignores case, punctuation and spacing", () => {
    expect(titleKey("Bitcoin  Tops $120K — Again!")).toBe(titleKey("bitcoin tops 120k again"));
  });

  it("publisherKey maps a domain and a display name to the same key", () => {
    expect(publisherKey("insidermonkey.com")).toBe("insidermonkey");
    expect(publisherKey("Insider Monkey")).toBe("insidermonkey");
    expect(publisherKey("www.Reuters.com")).toBe("reuters");
    expect(publisherKey("")).toBe("unknown");
  });

  it("keywordSentiment is small and bounded; label uses ±0.15", () => {
    expect(keywordSentiment("Bitcoin surges to record high")).toBeGreaterThan(0.15);
    expect(keywordSentiment("Ether plunges as liquidations mount")).toBeLessThan(-0.15);
    expect(keywordSentiment("Coinbase publishes quarterly update")).toBe(0);
    expect(Math.abs(keywordSentiment("surge rally gain rise jump soar boost record breakout"))).toBeLessThanOrEqual(0.5);
    expect(sentimentLabel(0.2)).toBe("bullish");
    expect(sentimentLabel(-0.2)).toBe("bearish");
    expect(sentimentLabel(0.1)).toBe("neutral");
  });
});

describe("matchSymbols", () => {
  it("finds names case-insensitively and tickers only in capitals", () => {
    const m = matchSymbols("Bitcoin and ETH rally while the yen slips", "");
    expect(m.get("BTC/USDT")).toBe(0.6);
    expect(m.get("ETH/USDT")).toBe(0.6);
    expect(m.get("USD/JPY")).toBe(0.6);
    expect(matchSymbols("the sol of the city", "").has("SOL/USDT")).toBe(false);
  });

  it("scores a summary-only mention lower than a title mention", () => {
    const m = matchSymbols("Crypto markets wrap", "Solana led gains; gold was flat.");
    expect(m.get("SOL/USDT")).toBe(0.3);
    expect(m.get("XAU/USD")).toBe(0.3);
  });

  it("respects word boundaries and does not match inside other words", () => {
    expect(matchSymbols("Golden Visa rules change", "").has("XAU/USD")).toBe(false);
    expect(matchSymbols("Dotcom nostalgia", "").has("DOT/USDT")).toBe(false);
  });

  it("matches index and forex aliases with symbols in them", () => {
    const m = matchSymbols("S&P 500 slips as EUR/USD climbs", "");
    expect(m.get("SPX")).toBe(0.6);
    expect(m.get("EUR/USD")).toBe(0.6);
  });
});
