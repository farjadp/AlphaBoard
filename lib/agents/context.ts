/**
 * The data block every session agent reads (spec §4.4 step 2). All numbers are computed server-side;
 * anything missing is written as "unavailable" so no agent is nudged to invent it (E15).
 * `formatContext` is pure and unit-tested; `gatherSymbol` does the market I/O.
 */
import { findAsset } from "@/lib/assetCatalog";
import { getFutures } from "@/lib/market/futures";
import { getNews } from "@/lib/market/news";
import { getQuote } from "@/lib/market/quote";
import { getIndicatorReport } from "@/lib/market/report";
import type { Mandate } from "@/lib/sessions/mandate";

export interface SymbolContext {
  symbol: string;
  price: number | null;
  changePct24h: number | null;
  timeframes: Array<{ timeframe: string; available: boolean; trend: string; stretch: string; rsi: number | null; atr: number | null; macd: string; ema: string }>;
  consensus: { netScore: number; dominantBias: string; confluenceStrength: string } | null;
  funding: { fundingRatePct: number | null; longPct: number | null; openInterestUsd: number | null } | null;
  news: Array<{ headline: string; sentiment: string; publishedAt: string | null; source?: string; sentimentSource?: string }>;
}

export interface PositionContext {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entryPrice: number;
  mark: number | null;
  unrealizedPnl: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  thesis: string;
  invalidation: string;
  horizonMin: number;
  ageMin: number;
}

export interface SessionUsage {
  equity: number | null;
  freeCapital: number;
  lossUsed: number;
  lossLimit: number;
  tradesUsed: number;
  maxTrades: number;
  openPositions: number;
  maxOpenPositions: number;
  timeLeftMin: number;
  llmCostUsd: number;
  maxLlmCostUsd: number;
}

export interface ContextData {
  now: string;
  mandate: Mandate;
  usage: SessionUsage;
  symbols: SymbolContext[];
  positions: PositionContext[];
  lessons: string[];
}

const NA = "unavailable";
const n = (v: number | null | undefined, digits = 6) => (v == null || !Number.isFinite(v) ? NA : Number(v.toPrecision(digits)).toLocaleString("en-US", { maximumFractionDigits: 8 }));
const usd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? NA : `$${v.toFixed(2)}`);
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export function formatMandate(m: Mandate): string {
  return [
    `Market: ${m.marketType}${m.marketType === "swap" ? ` (max leverage ${m.maxLeverage}x, ${m.marginMode})` : " (no shorts, no leverage)"}`,
    `Allowed symbols: ${m.symbols.join(", ")}`,
    `Capital: $${m.capital} · risk per trade ${m.riskPerTradePct}% · max position ${m.maxPositionPct}% of capital`,
    `Max open positions ${m.maxOpenPositions} · max trades ${m.maxTrades} · loss limit $${m.lossLimit} · cooldown after a stop ${m.cooldownMin} min`,
    `Decision interval ${m.decisionIntervalMin} min · session length ${m.durationMin} min`,
  ].join("\n");
}

/** How a headline's sentiment was obtained, in words the analyst can weigh. */
const SENTIMENT_BY: Record<string, string> = { provider: "scored by the news provider", votes: "reader votes", keywords: "keyword guess" };

export function formatSymbol(s: SymbolContext, opts: { technical: boolean; news: boolean }): string {
  const out = [`### ${s.symbol}`, `Price: ${n(s.price)} · 24h change: ${s.changePct24h == null ? NA : `${s.changePct24h.toFixed(2)}%`}`];
  if (opts.technical) {
    out.push(...s.timeframes.map((t) => (t.available
      ? `- ${t.timeframe}: trend ${t.trend} | stretch ${t.stretch} | RSI ${n(t.rsi, 3)} | ${t.macd} | ${t.ema} | ATR ${n(t.atr)}`
      : `- ${t.timeframe}: ${NA}`)));
    out.push(s.consensus
      ? `Consensus ${s.consensus.netScore}/100 (${s.consensus.dominantBias}, ${s.consensus.confluenceStrength})`
      : `Consensus: ${NA}`);
    if (s.funding) out.push(`Funding ${s.funding.fundingRatePct == null ? NA : `${n(s.funding.fundingRatePct, 3)}%`} · long accounts ${s.funding.longPct == null ? NA : `${s.funding.longPct.toFixed(1)}%`} · OI ${usd(s.funding.openInterestUsd)}`);
  }
  if (opts.news) {
    out.push("Headlines:");
    out.push(...(s.news.length ? s.news.map((h) => `- [${h.sentiment}${h.sentimentSource ? ` · ${SENTIMENT_BY[h.sentimentSource] ?? h.sentimentSource}` : ""}] ${oneLine(h.headline, 180)}${h.source ? ` — ${h.source}` : ""}${h.publishedAt ? ` (${h.publishedAt.slice(0, 16)})` : ""}`) : ["- none available"]));
  }
  return out.join("\n");
}

export function formatPositions(ps: PositionContext[]): string {
  if (!ps.length) return "No open positions.";
  return ps.map((p) => [
    `- id ${p.id} · ${p.side} ${n(p.qty)} ${p.symbol} @ ${n(p.entryPrice)} · mark ${n(p.mark)} · unrealized ${usd(p.unrealizedPnl)} · open ${p.ageMin} min`,
    `  stop ${n(p.stopLoss)} · target ${n(p.takeProfit)} · horizon ${p.horizonMin} min`,
    `  thesis: ${oneLine(p.thesis, 300)}`,
    `  invalidation: ${oneLine(p.invalidation, 200)}`,
  ].join("\n")).join("\n");
}

export function formatUsage(u: SessionUsage): string {
  return [
    `Equity ${usd(u.equity)} · free capital ${usd(u.freeCapital)}`,
    `Loss used ${usd(u.lossUsed)} of ${usd(u.lossLimit)} · trades ${u.tradesUsed}/${u.maxTrades} · open ${u.openPositions}/${u.maxOpenPositions}`,
    `Time left ${u.timeLeftMin} min · AI cost ${usd(u.llmCostUsd)} of ${usd(u.maxLlmCostUsd)}`,
  ].join("\n");
}

/** Full block for the strategist; analysts get the technical-only or news-only slice. */
export function formatContext(d: ContextData, view: "full" | "technical" | "news" = "full"): string {
  const opts = { technical: view !== "news", news: view !== "technical" };
  const parts = [
    `Time (UTC): ${d.now}`,
    "## MANDATE",
    formatMandate(d.mandate),
    "## MARKET",
    ...d.symbols.map((s) => formatSymbol(s, opts)),
  ];
  if (view === "full") {
    parts.push("## SESSION", formatUsage(d.usage), "## OPEN POSITIONS", formatPositions(d.positions));
    parts.push("## LESSONS FROM PAST SESSION TRADES", d.lessons.length ? d.lessons.map((l) => `- ${oneLine(l, 300)}`).join("\n") : "- none yet");
  }
  return parts.join("\n\n");
}

/** Market data for one symbol. Every sub-fetch fails soft to "unavailable". */
export async function gatherSymbol(symbol: string, marketType: Mandate["marketType"]): Promise<SymbolContext> {
  const asset = findAsset(symbol);
  const empty: SymbolContext = { symbol, price: null, changePct24h: null, timeframes: [], consensus: null, funding: null, news: [] };
  if (!asset) return empty;
  const [quote, report, news, futures] = await Promise.all([
    getQuote(asset).catch(() => null),
    getIndicatorReport(asset, "1H").catch(() => null),
    getNews(asset).catch(() => null),
    marketType === "swap" && asset.category === "crypto" ? getFutures(asset).catch(() => null) : Promise.resolve(null),
  ]);
  const wanted = new Set(["1D", "4H", "1H", "15M"]);
  return {
    symbol,
    price: quote?.price ?? null,
    changePct24h: quote?.changePct ?? null,
    timeframes: (report?.multiTimeframes ?? []).filter((t) => wanted.has(t.timeframe)).map((t) => ({
      timeframe: t.timeframe, available: t.available, trend: t.trendSignal, stretch: t.stretchSignal, rsi: t.rsi, atr: t.atr, macd: t.macdSignal, ema: t.emaSignal,
    })),
    consensus: report ? { netScore: report.consensusScore.netScore, dominantBias: report.consensusScore.dominantBias, confluenceStrength: report.consensusScore.confluenceStrength } : null,
    funding: futures ? { fundingRatePct: futures.fundingRatePct, longPct: futures.longPct, openInterestUsd: futures.openInterestUsd } : null,
    news: (news?.items ?? []).slice(0, 5).map((i) => ({ headline: i.headline, sentiment: i.sentiment, publishedAt: i.publishedAt, source: i.source, sentimentSource: i.sentimentSource })),
  };
}
