"use client";

import { useEffect, useState } from "react";
import PatternMiniVisual from "@/components/PatternMiniVisual";
import { formatPrice, formatSupply, formatVolume } from "@/lib/binance";
import { findAsset } from "@/lib/assetCatalog";
import { timeAgo } from "@/lib/format";
import type { CandlestickPatternMatch } from "@/lib/candlestickPatterns";
import type { ChartPatternMatch } from "@/lib/chartPatterns";
import type { FuturesSnapshot } from "@/lib/market/futures";
import type { BalanceSheet, Cashflow, GlobalMarket } from "@/lib/market/fundamentals";

const BIAS_TONE = { Bullish: "text-up", Bearish: "text-down", Neutral: "text-ink-2" } as const;

export function PatternsPanel({ timeframe, candle, chart, loading }: {
  timeframe: string;
  candle?: CandlestickPatternMatch | null;
  chart?: ChartPatternMatch | null;
  loading: boolean;
}) {
  return (
    <section aria-label="Patterns" className="panel flex flex-col gap-3 p-5">
      <span className="label-caps">Patterns on {timeframe}</span>
      {loading ? (
        <><div className="skeleton h-11" /><div className="skeleton h-11" /></>
      ) : (
        <>
          <PatternRow kind="candlestick" pattern={candle} empty="No clear candlestick pattern" />
          <PatternRow kind="chart" pattern={chart} empty="No clear chart structure" />
        </>
      )}
    </section>
  );
}

function PatternRow({ kind, pattern, empty }: { kind: "candlestick" | "chart"; pattern?: CandlestickPatternMatch | ChartPatternMatch | null; empty: string }) {
  return (
    <div className="flex items-center gap-3" title={pattern?.description}>
      <PatternMiniVisual pattern={pattern} variant={kind} className="h-11 w-14 shrink-0" />
      <div className="min-w-0">
        <b className="block truncate text-[14px] text-ink">{pattern?.name ?? empty}</b>
        {pattern && (
          <span className="text-[12px] text-ink-2">
            <span className={BIAS_TONE[pattern.bias]}>{pattern.bias}</span> · {kind === "chart" ? "chart pattern" : "candlestick"} · <span className="num">{pattern.confidence}%</span> match
          </span>
        )}
      </div>
    </div>
  );
}

export function FuturesPanel({ futures }: { futures: FuturesSnapshot | null | undefined }) {
  return (
    <section aria-label="Perpetual futures" className="panel flex flex-col gap-3 p-5">
      <span className="label-caps">Futures positioning</span>
      {futures === undefined ? (
        <div className="skeleton h-24" />
      ) : futures === null ? (
        <p className="text-[13px] text-ink-3">No perpetual-futures data for this asset right now.</p>
      ) : (
        <>
          <Row label="Funding rate" value={futures.fundingRatePct !== null ? `${futures.fundingRatePct.toFixed(4)}%` : "Unavailable"} />
          <Row label="Open interest" value={futures.openInterestUsd !== null ? formatVolume(futures.openInterestUsd) : "Unavailable"} />
          {futures.longPct !== null && futures.shortPct !== null && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[13px]">
                <span className="num text-up">{futures.longPct.toFixed(1)}% long</span>
                <span className="num text-down">{futures.shortPct.toFixed(1)}% short</span>
              </div>
              <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full" role="img" aria-label={`${futures.longPct.toFixed(1)} percent of accounts long`}>
                <rect x="0" width={futures.longPct} height="8" className="fill-up" />
                <rect x={futures.longPct} width={futures.shortPct} height="8" className="fill-down" />
              </svg>
              <span className="text-[11px] text-ink-3">Accounts long vs short · {futures.contract ?? ""} on {futures.source}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function MarketStatsPanel({ high, low, volume, source }: { high?: number; low?: number; volume?: number; source: string }) {
  return (
    <section aria-label="Market stats" className="panel flex flex-col gap-3 p-5">
      <span className="label-caps">24h market</span>
      <Row label="24h high" value={high ? formatPrice(high) : "Unavailable"} />
      <Row label="24h low" value={low ? formatPrice(low) : "Unavailable"} />
      <Row label="24h volume" value={volume ? formatVolume(volume) : "Unavailable"} />
      <span className="text-[11px] text-ink-3">Source: {source}</span>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line pb-2 text-[13px] last-of-type:border-b-0">
      <span className="text-ink-3">{label}</span>
      <span className="num text-ink">{value}</span>
    </div>
  );
}

interface NewsItem {
  id: string;
  publishedAt: string | null;
  source: string;
  headline: string;
  url: string | null;
  sentiment: "bullish" | "bearish" | "neutral";
}

export function NewsPanel({ symbol }: { symbol: string }) {
  const [state, setState] = useState<{ symbol: string; items: NewsItem[]; source: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`);
        const data = await res.json();
        if (!cancelled) setState({ symbol, items: data.items ?? [], source: data.source ?? "none" });
      } catch {
        if (!cancelled) setState((s) => s ?? { symbol, items: [], source: "none" });
      }
    }
    void load();
    const id = setInterval(load, 180_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);

  const current = state?.symbol === symbol ? state : null;
  const name = findAsset(symbol)?.name ?? symbol;

  return (
    <section aria-label="News" className="panel flex flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-caps">Latest on {name}</span>
        {current && current.source !== "none" && <span className="text-[11px] text-ink-3">{current.source}</span>}
      </div>
      {!current ? (
        <><div className="skeleton h-9" /><div className="skeleton h-9" /><div className="skeleton h-9" /></>
      ) : current.items.length === 0 ? (
        <p className="text-[13px] text-ink-3">No recent headlines for {name}.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {current.items.slice(0, 4).map((item) => (
            <li key={item.id} className="flex items-baseline gap-2.5 text-[13px] leading-snug">
              <span
                title={`Keyword sentiment (heuristic): ${item.sentiment}`}
                className={`size-2 shrink-0 translate-y-[-1px] rounded-full ${item.sentiment === "bullish" ? "bg-up" : item.sentiment === "bearish" ? "bg-down" : "bg-ink-3"}`}
              />
              {item.url
                ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-ink hover:underline">{item.headline}</a>
                : <span className="text-ink">{item.headline}</span>}
              <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-3">{timeAgo(item.publishedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FundamentalsStrip({ symbol, balance, cashflow, global }: {
  symbol: string;
  balance: BalanceSheet | null;
  cashflow: Cashflow | null;
  global: GlobalMarket | null;
}) {
  const items: Array<[string, string]> = [
    ["Market cap", balance?.marketCap ? formatVolume(balance.marketCap) : "Unavailable"],
    ["Fully diluted", balance?.fdv ? formatVolume(balance.fdv) : "Unavailable"],
    ["Circulating", balance?.circulatingSupply ? formatSupply(balance.circulatingSupply, symbol) : "Unavailable"],
    ["Max supply", balance?.maxSupply ? formatSupply(balance.maxSupply, symbol) : balance ? "No hard cap" : "Unavailable"],
    ["BTC dominance", global?.btcDominancePct != null ? `${global.btcDominancePct.toFixed(1)}%` : "Unavailable"],
  ];
  if (cashflow?.fees24h) items.push(["Chain fees 24h", formatVolume(cashflow.fees24h)]);
  if (cashflow?.revenue24h) items.push(["Chain revenue 24h", formatVolume(cashflow.revenue24h)]);

  return (
    <section aria-label="Fundamentals" className="panel flex flex-wrap gap-x-8 gap-y-3 px-5 py-4">
      <span className="label-caps w-full">Fundamentals</span>
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="text-[11.5px] text-ink-3">{label}</span>
          <span className={`num text-[14px] ${value === "Unavailable" ? "text-ink-3" : "text-ink"}`}>{value}</span>
        </div>
      ))}
    </section>
  );
}
