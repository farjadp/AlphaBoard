"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPrice, formatVolume, formatSupply } from "@/lib/binance";
import type { BinanceTicker } from "@/lib/binance";
import type { TradfiQuote } from "@/hooks/useTradfiQuotes";
import type { CandlestickPatternMatch } from "@/lib/candlestickPatterns";
import type { ChartPatternMatch } from "@/lib/chartPatterns";
import AiAnalysis from "./AiAnalysis";
import type { AnalysisResult } from "./AiAnalysis";
import PatternMiniVisual from "./PatternMiniVisual";
import NewsFeed from "./NewsFeed";
import { findAsset } from "@/lib/assetCatalog";
import { CONSENSUS_TIMEFRAMES, REPORT_TIMEFRAMES, TIMEFRAMES, type TimeframeKey } from "@/lib/market/timeframes";
import type { FuturesSnapshot } from "@/lib/market/futures";
import type { BalanceSheet, Cashflow, GlobalMarket } from "@/lib/market/fundamentals";

interface MacdData { MACD?: number; signal?: number; histogram?: number; }
interface BollingerBandsData { lower: number; middle: number; upper: number; pb?: number; }
interface MultiTimeframeIndicator {
  timeframe: string;
  rsi: number | null;
  rsiSignal: string;
  macdSignal: string;
  ema20: number | null;
  emaSignal: string;
  trendSignal: "Bullish" | "Bearish" | "Neutral";
  stretchSignal?: "Overbought" | "Oversold" | "Neutral";
  atr?: number | null;
  candlestickPattern?: CandlestickPatternMatch;
  chartPattern?: ChartPatternMatch;
  available: boolean;
  unavailableReason?: string;
  candleCount?: number;
  lastCandleTime?: number | null;
}
interface IndicatorsData {
  timeframe?: string;
  available?: boolean;
  trendSignal?: "Bullish" | "Bearish" | "Neutral";
  stretchSignal?: "Overbought" | "Oversold" | "Neutral";
  rsi: number;
  rsiSignal: string;
  macd: MacdData;
  macdSignal: string;
  sma50: number;
  smaSignal: string;
  ema20: number;
  emaSignal: string;
  bollingerBands: BollingerBandsData;
  bbSignal: string;
  atr?: number | null;
  candlestickPattern?: CandlestickPatternMatch;
  candlestickMatches?: CandlestickPatternMatch[];
  chartPattern?: ChartPatternMatch;
  chartPatternMatches?: ChartPatternMatch[];
  multiTimeframes?: MultiTimeframeIndicator[];
  consensusScore?: {
    bullishPressure: number;
    bearishPressure: number;
    netScore: number;
    dominantBias: "Bullish" | "Bearish" | "Neutral";
    coverage: number;
    confluenceStrength?: "Strong" | "Moderate" | "Weak" | "Conflicting";
  };
}

type TimeframeSortMode = "default" | "bullish_first" | "bearish_first" | "neutral_first";
export type ReportTimeframe = TimeframeKey;

const TIMEFRAME_ORDER: string[] = CONSENSUS_TIMEFRAMES;
// Yahoo serves real 5m/15m/60m bars for indices, commodities and FX, so every timeframe is
// available for every asset (v1 fed daily candles into "intraday" slots for non-crypto).
export const REPORT_TIMEFRAME_OPTIONS: Array<{ key: ReportTimeframe; label: string }> =
  REPORT_TIMEFRAMES.map((key) => ({ key, label: TIMEFRAMES[key].label }));

interface StatsPanelProps { symbol: string; ticker?: BinanceTicker; tradfiQuote?: TradfiQuote; }

export default function StatsPanel({ symbol, ticker, tradfiQuote }: StatsPanelProps) {
  const asset = findAsset(symbol);
  const isCrypto = asset?.category === "crypto";
  const timeframeOptions = REPORT_TIMEFRAME_OPTIONS;
  const [futures, setFutures] = useState<FuturesSnapshot | null>(null);
  const [global, setGlobal] = useState<GlobalMarket | null>(null);
  const [cashflow, setCashflow] = useState<Cashflow | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null);
  const [indicators, setIndicators] = useState<IndicatorsData | null>(null);
  const [aiRecommendation, setAiRecommendation] = useState<AnalysisResult | null>(null);
  const [aiRecommendationLoading, setAiRecommendationLoading] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState<ReportTimeframe>(isCrypto ? "1H" : "1D");

  function handleTimeframeChange(next: ReportTimeframe) {
    if (next === selectedTimeframe) return;
    setSelectedTimeframe(next);
    setIndicators(null);
    setAiRecommendation(null);
    setAiRecommendationLoading(false);
  }

  // Funding, open interest and long/short ratio come from our server (Binance → Bybit → OKX chain).
  useEffect(() => {
    if (!isCrypto) return;
    let cancelled = false;
    const load = () => fetch(`/api/futures?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : { futures: null }))
      .then((d) => { if (!cancelled) setFutures(d.futures ?? null); })
      .catch(() => { if (!cancelled) setFutures(null); });
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, isCrypto]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/global").then((r) => r.json()).then((d) => { if (!cancelled) setGlobal(d.global ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cashflow?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((d) => {
      if (!cancelled) setCashflow(d.cashflow ?? null);
    }).catch(() => { if (!cancelled) setCashflow(null); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/balancesheet?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((d) => {
      if (!cancelled) setBalanceSheet(d.balanceSheet ?? null);
    }).catch(() => { if (!cancelled) setBalanceSheet(null); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/indicators?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(selectedTimeframe)}`).then((r) => r.json()).then((d) => {
      if (!cancelled) setIndicators(d.error ? null : d);
    }).catch(() => { if (!cancelled) setIndicators(null); });
    return () => { cancelled = true; };
  }, [selectedTimeframe, symbol]);

  const high = ticker?.high ?? (tradfiQuote?.high || undefined);
  const low = ticker?.low ?? (tradfiQuote?.low || undefined);
  const volume = ticker?.volume ?? (tradfiQuote?.volume || undefined);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start w-full">
      {/* Column 3: AI & News */}
      <div className="xl:col-span-8">
        <AiAnalysis
          key={`${symbol}-${selectedTimeframe}`}
          symbol={symbol}
          indicators={indicators}
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={handleTimeframeChange}
          onResultChange={setAiRecommendation}
          onLoadingChange={setAiRecommendationLoading}
          timeframeOptions={timeframeOptions}
        />
      </div>

      {/* Column 2: Derivatives & Cashflow */}
      <div className="xl:col-span-4 flex flex-col gap-4">
        {isCrypto && <DerivativesCard futures={futures} />}

        <AiRecommendationCard result={aiRecommendation} loading={aiRecommendationLoading} />
      </div>

      {/* Column 1: Fundamentals */}
      <div className="xl:col-span-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <Card title="Market Stats" icon="📊">
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-2xl p-3" style={{ background: "linear-gradient(135deg, rgba(52,211,153,0.08), rgba(34,211,238,0.05))", border: "1px solid rgba(52,211,153,0.12)" }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: "var(--green)", boxShadow: "0 0 8px var(--green-glow)" }} />
                <span className="text-xs" style={{ color: "var(--text-3)" }}>24h Range</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span style={{ color: "var(--green)" }}>{high ? formatPrice(high) : "—"}</span>
                <span style={{ color: "var(--text-3)" }}>/</span>
                <span style={{ color: "var(--red)" }}>{low ? formatPrice(low) : "—"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <DetailPill label="24h Volume" value={volume ? formatVolume(volume) : "—"} />
              {isCrypto ? (
                <>
                  <DetailPill label="Crypto Mkt Cap" value={global?.totalMarketCapLabel ?? "—"} />
                  <DetailPill label="BTC Dom." value={global?.btcDominancePct != null ? `${global.btcDominancePct.toFixed(1)}%` : "—"} />
                  <DetailPill label="ETH Dom." value={global?.ethDominancePct != null ? `${global.ethDominancePct.toFixed(1)}%` : "—"} />
                </>
              ) : (
                <>
                  <DetailPill label="24h High" value={high ? formatPrice(high) : "—"} />
                  <DetailPill label="24h Low" value={low ? formatPrice(low) : "—"} />
                  <DetailPill label="Source" value="Yahoo Finance" />
                </>
              )}
            </div>
          </div>
        </Card>

        {isCrypto && (
        <Card title="Balance Sheet" icon="🏦">
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-2xl p-3" style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(82,170,255,0.05))", border: "1px solid rgba(168,85,247,0.12)" }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }} />
                <span className="text-xs" style={{ color: "var(--text-3)" }}>Valuation</span>
              </div>
              <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>{balanceSheet?.marketCap ? formatVolume(balanceSheet.marketCap) : "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <DetailPill label="Market Cap" value={balanceSheet?.marketCap ? formatVolume(balanceSheet.marketCap) : "—"} />
              <DetailPill label="FDV" value={balanceSheet?.fdv ? formatVolume(balanceSheet.fdv) : "—"} />
              <DetailPill label="Circulating" value={balanceSheet?.circulatingSupply ? formatSupply(balanceSheet.circulatingSupply, symbol) : "—"} />
              <DetailPill label="Max Supply" value={balanceSheet?.maxSupply ? formatSupply(balanceSheet.maxSupply, symbol) : balanceSheet ? "No hard cap" : "—"} />
            </div>
          </div>
        </Card>
        )}

        {isCrypto && cashflow && (
        <Card title="Chain Fees & Revenue" icon="💰">
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-2xl p-3" style={{ background: "linear-gradient(135deg, rgba(248,113,113,0.08), rgba(251,146,60,0.05))", border: "1px solid rgba(248,113,113,0.12)" }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: "var(--red)", boxShadow: "0 0 8px var(--red-glow)" }} />
                <span className="text-xs" style={{ color: "var(--text-3)" }}>Revenue (24h)</span>
              </div>
              <span className="text-xs font-semibold" style={{ color: "var(--red)" }}>{cashflow?.revenue24h ? formatVolume(cashflow.revenue24h) : "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <DetailPill label="Fees (24h)" value={cashflow?.fees24h ? formatVolume(cashflow.fees24h) : "—"} />
              <DetailPill label="Revenue (7d)" value={cashflow?.revenue7d ? formatVolume(cashflow.revenue7d) : "—"} />
              <DetailPill label="Fees (7d)" value={cashflow?.fees7d ? formatVolume(cashflow.fees7d) : "—"} />
              <DetailPill label="Revenue (30d)" value={cashflow?.revenue30d ? formatVolume(cashflow.revenue30d) : "—"} />
            </div>
            <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Source: DefiLlama</p>
          </div>
        </Card>
        )}

        <PatternCard timeframe={indicators?.timeframe || selectedTimeframe} pattern={indicators?.candlestickPattern} matches={indicators?.candlestickMatches} />

        <ChartPatternCard timeframe={indicators?.timeframe || selectedTimeframe} pattern={indicators?.chartPattern} matches={indicators?.chartPatternMatches} />

        <div className="md:col-span-2 xl:col-span-3">
          <MultiTimeframeIndicatorsCard key={symbol} indicators={indicators?.multiTimeframes} consensusScore={indicators?.consensusScore} />
        </div>

        <div className="md:col-span-2 xl:col-span-2">
          <NewsFeed key={symbol} symbol={symbol} />
        </div>
      </div>
    </div>
  );
}

function SortPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ease-out hover:scale-105 active:scale-95"
      style={{
        background: active ? "var(--accent-dim)" : "var(--surface-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        color: active ? "var(--accent)" : "var(--text-2)",
        boxShadow: active ? "0 0 12px rgba(82,170,255,0.2)" : "none",
      }}
    >
      {label}
    </button>
  );
}

function TimeframeTrendBadge({ tone, label, subdued }: { tone: "Bullish" | "Bearish" | "Neutral"; label: string; subdued?: boolean }) {
  const styles = subdued
    ? { background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-3)", boxShadow: "none" }
    : tone === "Bullish"
      ? { background: "var(--green-bg)", borderColor: "rgba(52, 211, 153, 0.35)", color: "var(--green)", boxShadow: "0 0 18px rgba(52, 211, 153, 0.16)" }
      : tone === "Bearish"
        ? { background: "var(--red-bg)", borderColor: "rgba(248, 113, 113, 0.35)", color: "var(--red)", boxShadow: "0 0 18px rgba(248, 113, 113, 0.16)" }
        : { background: "rgba(148, 163, 184, 0.08)", borderColor: "rgba(148, 163, 184, 0.28)", color: "#cbd5e1", boxShadow: "0 0 14px rgba(148, 163, 184, 0.08)" };

  return (
    <span className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border" style={styles}>
      {label}
    </span>
  );
}

function DetailPill({ label, value, signal }: { label: string; value: string; signal?: string }) {
  const signalColor = signal === "Bullish" ? "var(--green)" : signal === "Bearish" ? "var(--red)" : "var(--text)";

  return (
    <div className="rounded-xl px-3 py-3 transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))", border: "1px solid var(--border)" }}>
      <p className="text-[10px] uppercase tracking-wider mb-1 transition-colors duration-200" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className="text-xs font-semibold transition-colors duration-200" style={{ color: signal ? signalColor : "var(--text)" }}>{value}</p>
    </div>
  );
}

function ChartPatternCard({ timeframe, pattern, matches }: { timeframe: string; pattern?: ChartPatternMatch; matches?: ChartPatternMatch[] }) {
  const relatedMatches = (matches ?? []).filter((match) => match.key !== pattern?.key).slice(0, 3);

  return (
    <Card title="Chart Pattern" icon="📐">
      <div className="p-4 flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
          <PatternMiniVisual pattern={pattern} variant="chart" className="w-20 h-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{pattern?.name || "No Clear Chart Pattern"}</p>
              <PatternBiasBadge bias={pattern?.bias || "Neutral"} />
            </div>
            <p className="text-[11px] mt-1 leading-5" style={{ color: "var(--text-3)" }}>{pattern?.description || "No dominant chart structure is active in the recent swing data."}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <PatternMetric label="Timeframe" value={timeframe} />
          <PatternMetric label="Bias" value={pattern?.bias || "Neutral"} signal={pattern?.bias} />
          <PatternMetric label="Confidence" value={pattern ? `${pattern.confidence}%` : "—"} />
        </div>

        {relatedMatches.length > 0 && (
          <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Also Matching</p>
            <div className="flex flex-wrap gap-2">
              {relatedMatches.map((match) => (
                <span key={match.key} className="px-2.5 py-1 rounded-md text-[10px] font-medium" style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-2)",
                }}>
                  {match.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Card({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="glass-card overflow-hidden transition-all duration-300 ease-out hover:scale-[1.01] hover:shadow-2xl group">
      <div className="px-4 py-3 flex items-center gap-2 transition-colors duration-300" style={{ borderBottom: "1px solid var(--border)", background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))" }}>
        {icon && <span className="transition-transform duration-300 group-hover:scale-110" style={{ fontSize: "13px" }}>{icon}</span>}
        <span className="text-xs font-semibold tracking-wide transition-colors duration-300 group-hover:text-white" style={{ color: "var(--text-2)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function PatternCard({ timeframe, pattern, matches }: { timeframe: string; pattern?: CandlestickPatternMatch; matches?: CandlestickPatternMatch[] }) {
  const relatedMatches = (matches ?? []).filter((match) => match.key !== pattern?.key).slice(0, 3);

  return (
    <Card title="Candlestick Pattern" icon="🕯️">
      <div className="p-4 flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
          <PatternMiniVisual pattern={pattern} variant="candlestick" className="w-20 h-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{pattern?.name || "No Clear Pattern"}</p>
              <PatternBiasBadge bias={pattern?.bias || "Neutral"} />
            </div>
            <p className="text-[11px] mt-1 leading-5" style={{ color: "var(--text-3)" }}>{pattern?.description || "No actionable candlestick structure is currently dominant."}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <PatternMetric label="Timeframe" value={timeframe} />
          <PatternMetric label="Bias" value={pattern?.bias || "Neutral"} signal={pattern?.bias} />
          <PatternMetric label="Confidence" value={pattern ? `${pattern.confidence}%` : "—"} />
        </div>

        {relatedMatches.length > 0 && (
          <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Also Matching</p>
            <div className="flex flex-wrap gap-2">
              {relatedMatches.map((match) => (
                <span key={match.key} className="px-2.5 py-1 rounded-md text-[10px] font-medium" style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-2)",
                }}>
                  {match.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PatternMetric({ label, value, signal }: { label: string; value: string; signal?: string }) {
  const signalColor = signal === "Bullish" ? "var(--green)" : signal === "Bearish" ? "var(--red)" : "var(--text)";

  return (
    <div className="rounded-xl px-3 py-3 transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))", border: "1px solid var(--border)" }}>
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className="text-xs font-semibold tabular-nums" style={{ color: signal ? signalColor : "var(--text)" }}>{value}</p>
    </div>
  );
}

function PatternBiasBadge({ bias }: { bias: "Bullish" | "Bearish" | "Neutral" }) {
  const styles = bias === "Bullish"
    ? { background: "var(--green-bg)", color: "var(--green)", borderColor: "rgba(52, 211, 153, 0.25)" }
    : bias === "Bearish"
      ? { background: "var(--red-bg)", color: "var(--red)", borderColor: "rgba(248, 113, 113, 0.25)" }
      : { background: "var(--surface-2)", color: "var(--text-2)", borderColor: "var(--border)" };

  return (
    <span className="px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider border transition-all duration-200 hover:scale-105" style={styles}>
      {bias}
    </span>
  );
}

function MultiTimeframeIndicatorsCard({
  indicators,
  consensusScore,
}: {
  indicators?: MultiTimeframeIndicator[];
  consensusScore?: IndicatorsData["consensusScore"];
}) {
  const [sortMode, setSortMode] = useState<TimeframeSortMode>("default");
  const [collapsedRows, setCollapsedRows] = useState<Record<string, boolean>>({});
  const orderedIndicators = useMemo(() => {
    const items = [...(indicators ?? [])];
    const orderMap = new Map(TIMEFRAME_ORDER.map((item, index) => [item, index]));
    const toneWeight = (tone: "Bullish" | "Bearish" | "Neutral") => tone === "Bullish" ? 3 : tone === "Neutral" ? 2 : 1;

    if (sortMode === "default") {
      return items.sort((a, b) => (orderMap.get(a.timeframe) ?? 99) - (orderMap.get(b.timeframe) ?? 99));
    }

    if (sortMode === "bullish_first") {
      return items.sort((a, b) => toneWeight(b.trendSignal) - toneWeight(a.trendSignal) || (orderMap.get(a.timeframe) ?? 99) - (orderMap.get(b.timeframe) ?? 99));
    }

    if (sortMode === "bearish_first") {
      return items.sort((a, b) => toneWeight(a.trendSignal) - toneWeight(b.trendSignal) || (orderMap.get(a.timeframe) ?? 99) - (orderMap.get(b.timeframe) ?? 99));
    }

    return items.sort((a, b) => {
      const neutralRank = (tone: "Bullish" | "Bearish" | "Neutral") => tone === "Neutral" ? 0 : tone === "Bullish" ? 1 : 2;
      return neutralRank(a.trendSignal) - neutralRank(b.trendSignal) || (orderMap.get(a.timeframe) ?? 99) - (orderMap.get(b.timeframe) ?? 99);
    });
  }, [indicators, sortMode]);
  const allCollapsed = orderedIndicators.length > 0 && orderedIndicators.every((item) => collapsedRows[item.timeframe] ?? false);

  return (
    <Card title="Technical Indicators" icon="📈">
      <div className="p-4 flex flex-col gap-3">
        {consensusScore && (
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] mb-1" style={{ color: "var(--text-3)" }}>Consensus Score</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xl font-bold tabular-nums" style={{ color: consensusScore.netScore >= 57 ? "var(--green)" : consensusScore.netScore <= 43 ? "var(--red)" : "var(--text)" }}>
                    {consensusScore.netScore}/100
                  </span>
                  <TimeframeTrendBadge tone={consensusScore.dominantBias} label={consensusScore.dominantBias} />
                  {consensusScore.confluenceStrength && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                      style={{
                        background: consensusScore.confluenceStrength === "Strong"
                          ? "rgba(52,211,153,0.15)"
                          : consensusScore.confluenceStrength === "Moderate"
                            ? "rgba(96,165,250,0.15)"
                            : consensusScore.confluenceStrength === "Conflicting"
                              ? "rgba(251,146,60,0.15)"
                              : "rgba(255,255,255,0.06)",
                        color: consensusScore.confluenceStrength === "Strong"
                          ? "#34d399"
                          : consensusScore.confluenceStrength === "Moderate"
                            ? "#60a5fa"
                            : consensusScore.confluenceStrength === "Conflicting"
                              ? "#fb923c"
                              : "var(--text-3)",
                        border: `1px solid ${consensusScore.confluenceStrength === "Strong"
                          ? "rgba(52,211,153,0.3)"
                          : consensusScore.confluenceStrength === "Moderate"
                            ? "rgba(96,165,250,0.3)"
                            : consensusScore.confluenceStrength === "Conflicting"
                              ? "rgba(251,146,60,0.3)"
                              : "rgba(255,255,255,0.1)"}`,
                      }}
                    >
                      {consensusScore.confluenceStrength === "Conflicting" ? "⚠ Conflicting HTF/LTF" : `${consensusScore.confluenceStrength} Confluence`}
                    </span>
                  )}
                </div>
              </div>
              <DetailPill label="Coverage" value={`${consensusScore.coverage}%`} />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[11px]" style={{ color: "var(--text-2)" }}>
                <span>Bullish {consensusScore.bullishPressure}%</span>
                <span>Bearish {consensusScore.bearishPressure}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface)" }}>
                <div className="h-full" style={{ width: `${consensusScore.bullishPressure}%`, background: "linear-gradient(90deg, #34d399, #22d3ee)" }} />
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <SortPill label="Default" active={sortMode === "default"} onClick={() => setSortMode("default")} />
            <SortPill label="Bullish First" active={sortMode === "bullish_first"} onClick={() => setSortMode("bullish_first")} />
            <SortPill label="Bearish First" active={sortMode === "bearish_first"} onClick={() => setSortMode("bearish_first")} />
            <SortPill label="Neutral First" active={sortMode === "neutral_first"} onClick={() => setSortMode("neutral_first")} />
          </div>

          <button
            onClick={() => setCollapsedRows(Object.fromEntries(orderedIndicators.map((item) => [item.timeframe, !allCollapsed])))}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ease-out hover:scale-105 hover:shadow-lg active:scale-95"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-2)" }}
          >
            {allCollapsed ? "Expand All" : "Collapse All"}
          </button>
        </div>

        <div className="hidden lg:grid grid-cols-[80px_100px_120px_120px_140px_1fr] gap-3 px-3 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
          <span>Timeframe</span>
          <span>Trend</span>
          <span>RSI</span>
          <span>MACD</span>
          <span>EMA 20</span>
          <span>Pattern</span>
        </div>

        <div className="flex flex-col gap-2">
          {orderedIndicators.length > 0 ? orderedIndicators.map((item) => {
            const collapsed = collapsedRows[item.timeframe] ?? false;

            return (
              <div key={item.timeframe} className="rounded-xl px-3 py-3 transition-all duration-200 hover:scale-[1.01] hover:shadow-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <button
              onClick={() => setCollapsedRows((current) => ({ ...current, [item.timeframe]: !collapsed }))}
              className="w-full grid grid-cols-1 lg:grid-cols-[80px_110px_120px_120px_140px_1fr_28px] gap-3 items-center text-left transition-all duration-200 hover:translate-x-0.5"
            >
                  <MetricBlock label="Timeframe" value={item.timeframe} strong />
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider lg:hidden" style={{ color: "var(--text-3)" }}>Trend</span>
                    <TimeframeTrendBadge tone={item.available ? item.trendSignal : "Neutral"} label={item.available ? item.trendSignal : "Unavailable"} subdued={!item.available} />
                  </div>
                  <MetricBlock label="RSI" value={item.available ? `${item.rsi ? item.rsi.toFixed(1) : "—"} · ${item.rsiSignal}` : "Unavailable"} signal={normalizeSignal(item.rsiSignal)} />
                  <MetricBlock label="MACD" value={item.available ? item.macdSignal : "Unavailable"} signal={normalizeSignal(item.macdSignal)} />
                  <MetricBlock label="EMA 20" value={item.available ? `${item.ema20 ? formatPrice(item.ema20) : "—"} · ${item.emaSignal}` : "Unavailable"} signal={normalizeSignal(item.emaSignal)} />
                  <div className="flex items-center gap-2 min-w-0">
                    <PatternMiniVisual pattern={item.available ? item.chartPattern || item.candlestickPattern : undefined} variant={item.chartPattern ? "chart" : "candlestick"} className="w-12 h-8 shrink-0" />
                    <MetricBlock label="Pattern" value={item.available ? item.chartPattern?.name || item.candlestickPattern?.name || "No Clear Pattern" : "Unavailable"} signal={item.available ? item.chartPattern?.bias || item.candlestickPattern?.bias : undefined} />
                  </div>
                  <span className="hidden lg:flex items-center justify-center text-sm font-bold" style={{ color: "var(--text-3)" }}>{collapsed ? "+" : "−"}</span>
                </button>

                {!collapsed && (
                  <div className="mt-3 pt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <DetailPill label="Trend Bias" value={item.available ? item.trendSignal : "Unavailable"} signal={item.available ? item.trendSignal : undefined} />
                    <DetailPill label="Stretch (RSI/BB)" value={item.available ? item.stretchSignal ?? "Neutral" : "Unavailable"} signal={item.stretchSignal === "Overbought" ? "Bearish" : item.stretchSignal === "Oversold" ? "Bullish" : undefined} />
                    <DetailPill label="Candlestick" value={item.available ? item.candlestickPattern?.name || "No Clear Pattern" : "Unavailable"} signal={item.available ? item.candlestickPattern?.bias : undefined} />
                    <DetailPill label="Chart Pattern" value={item.available ? item.chartPattern?.name || "No Clear Chart Pattern" : "Unavailable"} signal={item.available ? item.chartPattern?.bias : undefined} />
                    <DetailPill label="Data" value={item.available ? `${item.candleCount ?? "?"} candles${item.lastCandleTime ? ` · last ${new Date(item.lastCandleTime).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}` : item.unavailableReason ?? "Unavailable"} />
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="rounded-xl px-4 py-5 text-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-3)" }}>
              Loading multi-timeframe indicators...
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function MetricBlock({ label, value, signal, strong }: { label: string; value: string; signal?: string; strong?: boolean }) {
  const signalColor = signal === "Bullish" || signal === "Oversold" || signal?.startsWith("Above") ? "var(--green)"
    : signal === "Bearish" || signal === "Overbought" || signal?.startsWith("Below") ? "var(--red)"
      : "var(--text)";

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wider lg:hidden" style={{ color: "var(--text-3)" }}>{label}</span>
      <span className={`text-xs ${strong ? "font-bold" : "font-medium"} truncate`} style={{ color: signal ? signalColor : "var(--text)" }}>{value}</span>
    </div>
  );
}

function normalizeSignal(value?: string) {
  if (!value) return undefined;
  if (value === "Oversold") return "Bullish";
  if (value === "Overbought") return "Bearish";
  if (value.startsWith("Above")) return "Bullish";
  if (value.startsWith("Below")) return "Bearish";
  if (value === "Bullish" || value === "Bearish") return value;
  return undefined;
}

function AiRecommendationCard({ result, loading }: { result: AnalysisResult | null; loading: boolean }) {
  const tone = result?.signal === "BUY" ? "Bullish" : result?.signal === "SELL" ? "Bearish" : "Neutral";
  const summary = !result
    ? "Run Generate Advanced Strategy to get a direct, actionable recommendation for this asset."
    : result.signal === "BUY"
      ? `If I were you, I would wait for price to trade near ${formatPrice(result.entry)} and then look for a controlled long entry with disciplined risk.`
      : result.signal === "SELL"
        ? `If I were you, I would avoid impulsive longs and consider a short or de-risking near ${formatPrice(result.entry)} with a defined invalidation.`
        : `If I were you, I would stay patient for now and wait for a cleaner setup before committing capital.`;

  return (
    <div className="glass-card p-4 flex flex-col gap-4">
      <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "linear-gradient(135deg, rgba(82,170,255,0.12), rgba(168,85,247,0.08))", border: "1px solid var(--border-strong)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>If I Were You</p>
            <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
              {loading ? "Building a recommendation from all available data…" : summary}
            </p>
          </div>
          <TimeframeTrendBadge tone={loading ? "Neutral" : tone} label={loading ? "Thinking" : result?.signal || "Waiting"} subdued={!result && !loading} />
        </div>

        {result && !loading && (
          <div className="grid grid-cols-2 gap-2">
            <DetailPill label="Timeframe" value={result.timeframe} signal={tone} />
            <DetailPill label="Confidence" value={`${result.confidence}%`} signal={tone} />
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-2xl px-3 py-4 text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-3)" }}>
          Synthesizing timeframe, risk, leverage, and entry plan…
        </div>
      ) : result ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <DetailPill label="Entry" value={formatPrice(result.entry)} />
            <DetailPill label="Stop Loss" value={formatPrice(result.stopLoss)} signal="Bearish" />
            <DetailPill label="Take Profit" value={formatPrice(result.takeProfit)} signal="Bullish" />
            <DetailPill label="Trade Style" value={result.tradeStyle || "N/A"} />
          </div>

          {result.risk_management && (
            <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span style={{ color: "var(--text-3)" }}>Leverage</span>
                <span className="font-semibold" style={{ color: "var(--text)" }}>{result.risk_management.leverage}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span style={{ color: "var(--text-3)" }}>Position Size</span>
                <span className="font-semibold" style={{ color: "var(--text)" }}>{result.risk_management.positionSize}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span style={{ color: "var(--text-3)" }}>Risk / Reward</span>
                <span className="font-semibold" style={{ color: tone === "Bullish" ? "var(--green)" : tone === "Bearish" ? "var(--red)" : "var(--text)" }}>{result.risk_management.riskRewardRatio}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>Distance</p>
                  <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>{result.risk_management.distanceToTarget}</p>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>Bias</p>
                  <p className="text-xs font-semibold" style={{ color: tone === "Bullish" ? "var(--green)" : tone === "Bearish" ? "var(--red)" : "var(--text)" }}>{result.signal}</p>
                </div>
              </div>
              <p className="text-[11px] leading-5" style={{ color: "var(--text-2)" }}>
                {result.risk_management.leverageReasoning}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl px-3 py-4 text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-3)" }}>
          No recommendation yet. Generate a strategy and this panel will condense the action, timeframe, and risk plan.
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, last, signal }: { label: string; value: string; last?: boolean; signal?: string }) {
  const signalColor = signal === "Bullish" || signal === "Buy" ? "var(--green)" : signal === "Bearish" || signal === "Sell" ? "var(--red)" : undefined;
  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 stat-row"
      style={{ borderBottom: last ? "none" : "1px solid var(--border)" }}
    >
      <span className="text-xs" style={{ color: "var(--text-3)" }}>{label}</span>
      <span className="text-xs font-medium tabular-nums" style={{ color: signalColor || "var(--text)" }}>{value}</span>
    </div>
  );
}

function DerivativesCard({ futures }: { futures: FuturesSnapshot | null }) {
  if (!futures) {
    return (
      <Card title="Perpetual Futures" icon="⚡">
        <p className="px-4 py-3 text-xs" style={{ color: "var(--text-3)" }}>No perpetual-futures data for this asset right now.</p>
      </Card>
    );
  }
  const hasRatio = futures.longPct !== null && futures.shortPct !== null;
  return (
    <Card title="Perpetual Futures" icon="⚡">
      <StatRow label="Funding Rate" value={futures.fundingRatePct !== null ? `${futures.fundingRatePct.toFixed(4)}%` : "—"} />
      <StatRow label="Open Interest" value={futures.openInterestUsd !== null ? formatVolume(futures.openInterestUsd) : "—"} last={!hasRatio} />
      {hasRatio && (
        <div className="px-4 py-3 flex flex-col gap-2">
          <div className="flex justify-between text-[11px] font-medium">
            <span style={{ color: "var(--green)" }}>{futures.longPct!.toFixed(1)}% long</span>
            <span style={{ color: "var(--red)" }}>{futures.shortPct!.toFixed(1)}% short</span>
          </div>
          <div className="flex rounded-full overflow-hidden h-2" style={{ background: "var(--border)" }} role="img" aria-label={`${futures.longPct!.toFixed(1)} percent of accounts long`}>
            <div style={{ width: `${futures.longPct}%`, background: "var(--green)" }} />
            <div style={{ width: `${futures.shortPct}%`, background: "var(--red)" }} />
          </div>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
            Account long/short ratio · {futures.contract ?? ""} on {futures.source}
          </p>
        </div>
      )}
    </Card>
  );
}
