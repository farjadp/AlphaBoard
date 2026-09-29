import { NEWS_ALIASES } from "./aliases";

export const RELEVANCE = { tagged: 1, title: 0.6, summary: 0.3 } as const;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isTicker = (a: string) => /^[A-Z0-9$&/]+$/.test(a) && a === a.toUpperCase();

/** One regex per symbol. Letters/digits must not touch the alias on either side ("Golden" ≠ gold). */
const PATTERNS: Array<[string, RegExp[]]> = Object.entries(NEWS_ALIASES).map(([symbol, aliases]) => [
  symbol,
  aliases.map((a) => new RegExp(`(?<![A-Za-z0-9])\\$?${esc(a)}(?![A-Za-z0-9])`, isTicker(a) ? "" : "i")),
]);

/** Symbols named in a headline (0.6) or only in its summary (0.3). */
export function matchSymbols(title: string, summary: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const [symbol, res] of PATTERNS) {
    if (res.some((r) => r.test(title))) out.set(symbol, RELEVANCE.title);
    else if (summary && res.some((r) => r.test(summary))) out.set(symbol, RELEVANCE.summary);
  }
  return out;
}
