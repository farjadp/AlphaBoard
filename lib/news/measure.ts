import "server-only";
import { prisma } from "@/lib/prisma";
import { findAsset, type Asset } from "@/lib/assetCatalog";
import { getCandles } from "@/lib/market/candles";
import { rankedNews } from "./read";
import { newsIndex } from "./score";
import { accuracy, correlation, returnsAfter, type Accuracy, type HourBar } from "./stats";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export type BarsOf = (symbol: string) => Promise<HourBar[] | null>;

const liveHourBars: BarsOf = async (symbol) => {
  const asset = findAsset(symbol);
  if (!asset) return null;
  return (await getCandles(asset, "1H")).flatMap((c) => (c.time == null ? [] : [{ time: c.time, open: c.open }]));
};

/** Once per UTC hour per symbol: weighted mean sentiment of the last 24 h (shadow mode — never shown to agents). */
export async function snapshotIndex(targets: Asset[], now = new Date()): Promise<number> {
  const at = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const done = new Set((await prisma.newsIndexSnapshot.findMany({ where: { at }, select: { symbol: true } })).map((s) => s.symbol));
  let n = 0;
  for (const a of targets) {
    if (done.has(a.symbol)) continue;
    const ranked = await rankedNews(a.symbol, { now, windowH: 24 });
    const idx = newsIndex(ranked.map((r) => ({ weight: r.weight, sentiment: r.sentiment })));
    if (!idx) continue;
    await prisma.newsIndexSnapshot.create({ data: {
      symbol: a.symbol, at, score: idx.score, weightSum: idx.weightSum, articles: ranked.length, publishers: new Set(ranked.map((r) => r.publisherKey)).size,
    } }).catch(() => undefined); // another run won the unique (symbol, at)
    n++;
  }
  return n;
}

/**
 * Fills 4 h / 24 h returns for article links and snapshots that are at least 24 h old, from 1H candles.
 * Rows the candles no longer cover (older than ~10 days) are closed with null returns.
 */
export async function evaluatePending(now = new Date(), barsOf: BarsOf = liveHourBars): Promise<{ links: number; snapshots: number }> {
  const ripe = new Date(now.getTime() - DAY);
  const giveUp = now.getTime() - 3 * DAY;
  const [links, snaps] = await Promise.all([
    prisma.newsArticleSymbol.findMany({ where: { evaluatedAt: null, article: { publishedAt: { lte: ripe } } }, select: { articleId: true, symbol: true, article: { select: { publishedAt: true } } }, take: 3_000 }),
    prisma.newsIndexSnapshot.findMany({ where: { evaluatedAt: null, at: { lte: ripe } }, select: { id: true, symbol: true, at: true }, take: 3_000 }),
  ]);
  const symbols = [...new Set([...links.map((l) => l.symbol), ...snaps.map((s) => s.symbol)])];
  const bars = new Map(await Promise.all(symbols.map(async (s) => [s, await barsOf(s).catch(() => null)] as const)));
  let nl = 0, ns = 0;

  const measure = (symbol: string, t: number) => {
    const b = bars.get(symbol);
    if (!b?.length) return t < giveUp ? { ret4h: null, ret24h: null } : null;
    const r = returnsAfter(b, t);
    if (r.p0 == null) return t < b[0].time ? { ret4h: null, ret24h: null } : null; // before coverage → close
    if (r.ret24h == null && t >= giveUp) return null; // candles not there yet → retry
    return { ret4h: r.ret4h, ret24h: r.ret24h };
  };

  for (const l of links) {
    const m = measure(l.symbol, l.article.publishedAt.getTime());
    if (!m) continue;
    await prisma.newsArticleSymbol.update({ where: { articleId_symbol: { articleId: l.articleId, symbol: l.symbol } }, data: { ...m, evaluatedAt: now } });
    nl++;
  }
  for (const s of snaps) {
    const m = measure(s.symbol, s.at.getTime());
    if (!m) continue;
    await prisma.newsIndexSnapshot.update({ where: { id: s.id }, data: { ...m, evaluatedAt: now } });
    ns++;
  }
  return { links: nl, snapshots: ns };
}

export interface PublisherRow { key: string; name: string; weight: number; window: Accuracy; lastWeek: Accuracy }

/** Directional accuracy per publisher over `days` (and the last 7), from evaluated article links. */
export async function publisherReport(now = new Date(), days = 30): Promise<{ publishers: PublisherRow[]; overall: Accuracy }> {
  const since = new Date(now.getTime() - days * DAY);
  const weekAgo = now.getTime() - 7 * DAY;
  const [pubs, rows] = await Promise.all([
    prisma.newsPublisher.findMany({ select: { key: true, name: true, weight: true } }),
    prisma.newsArticleSymbol.findMany({
      where: { evaluatedAt: { not: null }, article: { publishedAt: { gte: since } } },
      select: { sentiment: true, ret4h: true, ret24h: true, article: { select: { publisherKey: true, sentiment: true, publishedAt: true } } },
    }),
  ]);
  const scored = rows.map((r) => ({ key: r.article.publisherKey, at: r.article.publishedAt.getTime(), sentiment: r.sentiment ?? r.article.sentiment, ret4h: r.ret4h, ret24h: r.ret24h }));
  const publishers = pubs.map((p) => {
    const mine = scored.filter((s) => s.key === p.key);
    return { ...p, window: accuracy(mine), lastWeek: accuracy(mine.filter((s) => s.at >= weekAgo)) };
  }).sort((a, b) => b.window.calls - a.window.calls || a.key.localeCompare(b.key));
  return { publishers, overall: accuracy(scored) };
}

export interface IndexRow { symbol: string; snapshots: number; latest: { at: Date; score: number; articles: number } | null; accuracy: Accuracy; correlation24h: number | null }

export async function indexReport(now = new Date(), days = 30): Promise<{ symbols: IndexRow[]; overall: { accuracy: Accuracy; correlation24h: number | null } }> {
  const rows = await prisma.newsIndexSnapshot.findMany({ where: { at: { gte: new Date(now.getTime() - days * DAY) } }, orderBy: { at: "asc" } });
  const evaluated = rows.filter((r) => r.evaluatedAt && r.ret24h != null);
  const corr = (rs: typeof rows) => correlation(rs.map((r) => r.score), rs.map((r) => r.ret24h!));
  const toScored = (rs: typeof rows) => rs.map((r) => ({ sentiment: r.score, ret4h: r.ret4h, ret24h: r.ret24h }));
  const bySymbol = [...new Set(rows.map((r) => r.symbol))].map((symbol) => {
    const mine = rows.filter((r) => r.symbol === symbol);
    const ev = evaluated.filter((r) => r.symbol === symbol);
    const last = mine[mine.length - 1];
    return { symbol, snapshots: mine.length, latest: last ? { at: last.at, score: last.score, articles: last.articles } : null, accuracy: accuracy(toScored(ev)), correlation24h: corr(ev) };
  }).sort((a, b) => b.snapshots - a.snapshots);
  return { symbols: bySymbol, overall: { accuracy: accuracy(toScored(evaluated)), correlation24h: corr(evaluated) } };
}
