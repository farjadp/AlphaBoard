import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_WATCHLIST, findAsset, type Asset } from "@/lib/assetCatalog";
import { matchSymbols } from "./match";
import { PROVIDERS, type ProviderId, type ProviderSpec, type RawArticle } from "./sources";
import { canonicalUrl, keywordSentiment, publisherKey, titleKey } from "./text";

export const PROVIDER_STATE_KEY = "news.providers";
const MAX_AGE_MS = 7 * 86_400_000;
const TITLE_DEDUPE_MS = 48 * 3_600_000;

export interface ProviderState {
  day: string;
  count: number;
  lastCallAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  rotation: number;
  lastItems: number;
}
export type ProviderStates = Partial<Record<ProviderId, ProviderState>>;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const fresh = (day: string): ProviderState => ({ day, count: 0, lastCallAt: null, lastOkAt: null, lastError: null, lastErrorAt: null, rotation: 0, lastItems: 0 });

export async function readProviderStates(): Promise<ProviderStates> {
  const row = await prisma.appSetting.findUnique({ where: { key: PROVIDER_STATE_KEY } });
  return (row?.value as ProviderStates | undefined) ?? {};
}

/** Watchlists + symbols of sessions that are not finished + the default watchlist. */
export async function targetAssets(): Promise<Asset[]> {
  const [watch, sessions] = await Promise.all([
    prisma.watchlistItem.findMany({ distinct: ["symbol"], select: { symbol: true } }),
    prisma.tradingSession.findMany({ where: { status: { notIn: ["ENDED"] } }, select: { mandate: true } }),
  ]);
  const fromSessions = sessions.flatMap((s) => ((s.mandate as { symbols?: unknown })?.symbols as string[] | undefined) ?? []);
  const all = new Set([...DEFAULT_WATCHLIST, ...watch.map((w) => w.symbol), ...fromSessions]);
  return [...all].flatMap((s) => { const a = findAsset(s); return a ? [a] : []; });
}

export interface IngestResult { calls: Array<{ provider: ProviderId; symbol: string | null; items: number; error?: string }>; stored: number; merged: number }

/**
 * Calls every provider that is due and within its daily budget, then stores what came back.
 * Per-symbol providers rotate through the targets so every symbol gets its turn.
 */
export async function runIngest(opts: { now?: Date; providers?: ProviderSpec[]; targets?: Asset[] } = {}): Promise<IngestResult> {
  const now = opts.now ?? new Date();
  const providers = (opts.providers ?? PROVIDERS).filter((p) => p.enabled());
  const targets = opts.targets ?? await targetAssets();
  const states = await readProviderStates();
  const day = utcDay(now);
  const calls: IngestResult["calls"] = [];
  const raw: RawArticle[] = [];

  await Promise.all(providers.map(async (p) => {
    let st = states[p.id] && states[p.id]!.day === day ? states[p.id]! : { ...fresh(day), rotation: states[p.id]?.rotation ?? 0, lastCallAt: states[p.id]?.lastCallAt ?? null, lastOkAt: states[p.id]?.lastOkAt ?? null };
    if (st.lastCallAt && now.getTime() - Date.parse(st.lastCallAt) < p.minIntervalMs) return;
    const pool = p.perSymbol ? targets.filter((a) => p.supports?.(a) ?? true) : [];
    if (p.perSymbol && !pool.length) return;
    const jobs: Array<Asset | null> = p.perSymbol
      ? Array.from({ length: Math.min(p.callsPerRun ?? 1, pool.length) }, (_, i) => pool[(st.rotation + i) % pool.length])
      : [null];
    for (const asset of jobs) {
      if (p.dailyBudget != null && st.count >= p.dailyBudget) break;
      st = { ...st, count: st.count + 1, lastCallAt: now.toISOString(), rotation: p.perSymbol ? st.rotation + 1 : st.rotation };
      try {
        const items = await p.fetch(asset);
        raw.push(...items);
        st = { ...st, lastOkAt: now.toISOString(), lastItems: items.length };
        calls.push({ provider: p.id, symbol: asset?.symbol ?? null, items: items.length });
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        st = { ...st, lastError: msg, lastErrorAt: now.toISOString() };
        calls.push({ provider: p.id, symbol: asset?.symbol ?? null, items: 0, error: msg });
      }
    }
    states[p.id] = st;
  }));

  const value = states as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: PROVIDER_STATE_KEY }, create: { key: PROVIDER_STATE_KEY, value }, update: { value } });
  const { stored, merged } = await storeArticles(raw, now);
  return { calls, stored, merged };
}

type Link = { symbol: string; relevance: number; sentiment: number | null };

function linksOf(a: RawArticle): Link[] {
  const m = new Map<string, Link>();
  for (const [symbol, relevance] of matchSymbols(a.title, a.summary)) m.set(symbol, { symbol, relevance, sentiment: null });
  for (const t of a.tags) {
    const cur = m.get(t.symbol);
    m.set(t.symbol, { symbol: t.symbol, relevance: Math.max(cur?.relevance ?? 0, t.relevance), sentiment: t.sentiment ?? cur?.sentiment ?? null });
  }
  return [...m.values()];
}

/**
 * De-duplicates by canonical URL, then by normalized title within 48 h; a repeat only adds its provider,
 * any new symbol links and a better sentiment. Articles that name no catalog symbol are not kept.
 */
export async function storeArticles(raw: RawArticle[], now = new Date()): Promise<{ stored: number; merged: number }> {
  const items = raw.flatMap((a) => {
    const urlKey = canonicalUrl(a.url);
    const t = a.publishedAt.getTime();
    if (!urlKey || t > now.getTime() + 3_600_000 || now.getTime() - t > MAX_AGE_MS) return [];
    const links = linksOf(a);
    return links.length ? [{ a, urlKey, titleKey: titleKey(a.title), links }] : [];
  });
  if (!items.length) return { stored: 0, merged: 0 };

  const existing = await prisma.newsArticle.findMany({
    where: { OR: [{ urlKey: { in: items.map((i) => i.urlKey) } }, { titleKey: { in: items.map((i) => i.titleKey) }, publishedAt: { gte: new Date(now.getTime() - MAX_AGE_MS - TITLE_DEDUPE_MS) } }] },
    select: { id: true, urlKey: true, titleKey: true, publishedAt: true, providers: true, sentimentSource: true, symbols: { select: { symbol: true, relevance: true } } },
  });
  let stored = 0, merged = 0;

  for (const it of items) {
    const hit = existing.find((e) => e.urlKey === it.urlKey)
      ?? existing.find((e) => e.titleKey === it.titleKey && Math.abs(e.publishedAt.getTime() - it.a.publishedAt.getTime()) <= TITLE_DEDUPE_MS);
    if (hit) {
      const betterSentiment = it.a.sentiment != null && it.a.sentimentSource && (hit.sentimentSource === "keywords" || (hit.sentimentSource === "votes" && it.a.sentimentSource === "provider"));
      const newProvider = !hit.providers.includes(it.a.provider);
      await prisma.$transaction([
        ...(newProvider || betterSentiment ? [prisma.newsArticle.update({ where: { id: hit.id }, data: {
          ...(newProvider ? { providers: { push: it.a.provider } } : {}),
          ...(betterSentiment ? { sentiment: it.a.sentiment!, sentimentSource: it.a.sentimentSource! } : {}),
        } })] : []),
        ...it.links.filter((l) => { const cur = hit.symbols.find((s) => s.symbol === l.symbol); return !cur || cur.relevance < l.relevance || l.sentiment != null; }).map((l) => prisma.newsArticleSymbol.upsert({
          where: { articleId_symbol: { articleId: hit.id, symbol: l.symbol } },
          create: { articleId: hit.id, symbol: l.symbol, relevance: l.relevance, sentiment: l.sentiment },
          update: { relevance: Math.max(l.relevance, hit.symbols.find((s) => s.symbol === l.symbol)?.relevance ?? 0), ...(l.sentiment != null ? { sentiment: l.sentiment } : {}) },
        })),
      ]);
      if (newProvider) hit.providers.push(it.a.provider);
      if (betterSentiment) hit.sentimentSource = it.a.sentimentSource!;
      merged++;
      continue;
    }
    const pk = publisherKey(it.a.publisher);
    const created = await prisma.$transaction(async (tx) => {
      await tx.newsPublisher.upsert({ where: { key: pk }, create: { key: pk, name: it.a.publisher.slice(0, 80) }, update: {} });
      return tx.newsArticle.create({
        data: {
          urlKey: it.urlKey, titleKey: it.titleKey, url: it.a.url, title: it.a.title.slice(0, 400), summary: it.a.summary,
          publisherKey: pk, publishedAt: it.a.publishedAt, fetchedAt: now, providers: [it.a.provider],
          sentiment: it.a.sentiment ?? keywordSentiment(it.a.title), sentimentSource: it.a.sentimentSource ?? "keywords",
          symbols: { create: it.links.map((l) => ({ symbol: l.symbol, relevance: l.relevance, sentiment: l.sentiment })) },
        },
        select: { id: true, urlKey: true, titleKey: true, publishedAt: true, providers: true, sentimentSource: true },
      });
    });
    existing.push({ ...created, symbols: it.links.map((l) => ({ symbol: l.symbol, relevance: l.relevance })) });
    stored++;
  }
  return { stored, merged };
}
