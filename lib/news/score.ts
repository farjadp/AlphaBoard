/**
 * Article weight = publisher credibility × recency × relevance × corroboration (spec: News Hub).
 * Pure functions; the DB layer feeds them.
 */
import type { AssetCategory } from "@/lib/assetCatalog";

const HALF_LIFE_H: Record<AssetCategory, number> = { crypto: 6, indices: 24, commodities: 24, forex: 24 };

export const recencyFactor = (ageHours: number, category: AssetCategory) =>
  ageHours <= 0 ? 1 : 0.5 ** (ageHours / HALF_LIFE_H[category]);

export const corroborationFactor = (publishers: number) => Math.min(1.5, 1 + 0.25 * (Math.max(1, publishers) - 1));

const STOP = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "are", "was", "its", "has", "have", "after", "over", "amid", "says", "will", "new"]);
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
};

/**
 * Same-story clusters by title similarity (Jaccard ≥ 0.5, single link). Returns, per article, how many
 * distinct publishers carried its story — repeats from one publisher do not count as confirmation.
 */
export function corroboration(items: Array<{ id: string; title: string; publisherKey: string }>): Map<string, number> {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sets = items.map((x) => words(x.title));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (jaccard(sets[i], sets[j]) >= 0.5) parent[find(i)] = find(j);
    }
  }
  const pubs = new Map<number, Set<string>>();
  items.forEach((x, i) => { const r = find(i); (pubs.get(r) ?? pubs.set(r, new Set()).get(r)!).add(x.publisherKey); });
  return new Map(items.map((x, i) => [x.id, pubs.get(find(i))!.size]));
}

export function articleWeight(a: { publisherWeight: number; ageHours: number; category: AssetCategory; relevance: number; publishers: number }) {
  return a.publisherWeight * recencyFactor(a.ageHours, a.category) * a.relevance * corroborationFactor(a.publishers);
}

/** Weighted mean sentiment (−1…+1); null when there is nothing to average. */
export function newsIndex(items: Array<{ weight: number; sentiment: number }>): { score: number; weightSum: number } | null {
  const weightSum = items.reduce((s, x) => s + x.weight, 0);
  if (!items.length || weightSum <= 0) return null;
  return { score: items.reduce((s, x) => s + x.weight * x.sentiment, 0) / weightSum, weightSum };
}
