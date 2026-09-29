/** Pure text helpers for the news hub: de-duplication keys, publisher keys, keyword sentiment. */

export type SentimentLabel = "bullish" | "bearish" | "neutral";
export type SentimentSource = "provider" | "votes" | "keywords";

/** Scheme + lowercase host (no www) + path without trailing slash. Query and fragment are tracking noise. */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

export const titleKey = (title: string) =>
  title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** "Insider Monkey", "insidermonkey.com" and "www.InsiderMonkey.com" all map to "insidermonkey". */
export function publisherKey(name: string): string {
  const k = name.toLowerCase().trim()
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/\.(com|net|org|io|co|news|co\.uk|com\.au)(\/.*)?$/, "")
    .replace(/[^a-z0-9]+/g, "");
  return k || "unknown";
}

const BULL = ["surge", "rally", "ralli", "gain", "rise", "bull", "record", "all-time high", "jump", "soar", "boost", "recover", "breakout", "inflow"];
const BEAR = ["drop", "fall", "crash", "bear", "plunge", "slump", "sell-off", "selloff", "fear", "decline", "tumble", "outflow", "liquidat"];
const hits = (t: string, words: string[]) => words.filter((w) => new RegExp(`\\b${w.replace(/[-]/g, "[- ]?")}`).test(t)).length;

/** Keyword heuristic, deliberately weak (|score| ≤ 0.5) so real provider scores dominate the index. */
export function keywordSentiment(title: string): number {
  const t = ` ${title.toLowerCase()} `;
  const s = (hits(t, BULL) - hits(t, BEAR)) * 0.25;
  return Math.max(-0.5, Math.min(0.5, s));
}

/** Alpha Vantage's own neutral band. */
export const sentimentLabel = (s: number): SentimentLabel => (s > 0.15 ? "bullish" : s < -0.15 ? "bearish" : "neutral");
