"use client";

import { useEffect, useMemo, useState } from "react";
import { PAIRS } from "@/lib/mockData";
import { formatPrice, formatVolume, formatSupply, pairToSymbol } from "@/lib/binance";
import type { BinanceTicker } from "@/lib/binance";
import type { TradfiQuote } from "@/hooks/useTradfiQuotes";
import type { CandlestickPatternMatch } from "@/lib/candlestickPatterns";
import type { ChartPatternMatch } from "@/lib/chartPatterns";
import AiAnalysis from "./AiAnalysis";
import type { AnalysisResult } from "./AiAnalysis";
import PatternMiniVisual from "./PatternMiniVisual";
import NewsFeed from "./NewsFeed";

interface FuturesData { fundingRate: string; openInterest: string; }
interface GlobalData { btcDominance: string; ethDominance: string; totalMarketCap: string; }
interface CashflowData { fees24h: number | null; fees7d: number | null; fees30d: number | null; revenue24h: number | null; revenue7d: number | null; revenue30d: number | null; }
interface BalanceSheetData { marketCap: number | null; fdv: number | null; circulatingSupply: number | null; maxSupply: number | null; }
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
  candlestickPattern?: CandlestickPatternMatch;
  chartPattern?: ChartPatternMatch;
  available: boolean;
}
interface IndicatorsData {
  timeframe?: string;
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
  };
}

type TimeframeSortMode = "default" | "bullish_first" | "bearish_first" | "neutral_first";
export type ReportTimeframe = "1M" | "1W" | "1D" | "4H" | "1H" | "15M";

const TIMEFRAME_ORDER = ["1Y", "3M", "1M", "1W", "4H", "45M", "15M", "5M"];
export const REPORT_TIMEFRAME_OPTIONS: Array<{ key: ReportTimeframe; label: string }> = [
  { key: "1M", label: "Monthly" },
  { key: "1W", label: "Weekly" },
  { key: "1D", label: "Daily" },
  { key: "4H", label: "4H" },
  { key: "1H", label: "1H" },
  { key: "15M", label: "15M" },
];

interface StatsPanelProps { symbol: string; ticker?: BinanceTicker; tradfiQuote?: TradfiQuote; }

export default function StatsPanel({ symbol, ticker, tradfiQuote }: StatsPanelProps) {
  const pair = PAIRS.find((p) => p.symbol === symbol);
  const [futures, setFutures] = useState<FuturesData | null>(null);
  const [global, setGlobal] = useState<GlobalData | null>(null);
  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [indicators, setIndicators] = useState<IndicatorsData | null>(null);
  const [aiRecommendation, setAiRecommendation] = useState<AnalysisResult | null>(null);
  const [aiRecommendationLoading, setAiRecommendationLoading] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState<ReportTimeframe>("1H");

  function handleTimeframeChange(next: ReportTimeframe) {
    if (next === selectedTimeframe) return;
    setSelectedTimeframe(next);
    setIndicators(null);
    setAiRecommendation(null);
    setAiRecommendationLoading(false);
  }

  // Fetch funding rate + open interest from Binance Futures
  useEffect(() => {
    const sym = pairToSymbol(symbol);
    let cancelled = false;
    async function fetchFutures() {
      try {
        const [premRes, oiRes] = await Promise.all([
          fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`),
          fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`),
        ]);
        if (!premRes.ok || !oiRes.ok) {
          if (!cancelled) setFutures(null);
          return;
        }
        const prem = await premRes.json();
        const oi = await oiRes.json();
        if (cancelled) return;
        const rate = (parseFloat(prem.lastFundingRate) * 100).toFixed(4) + "%";
        const oiVal = formatVolume(parseFloat(oi.openInterest) * (ticker?.price ?? 0));
        setFutures({ fundingRate: rate, openInterest: oiVal });
      } catch {
        if (!cancelled) setFutures(null);
      }
    }
    fetchFutures();
    const id = setInterval(fetchFutures, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, ticker?.price]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/global").then((r) => r.json()).then((d) => { if (!cancelled) setGlobal(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cashflow").then((r) => r.json()).then((d) => {
      if (!cancelled) setCashflow(d[symbol] ?? null);
    }).catch(() => { if (!cancelled) setCashflow(null); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/balancesheet").then((r) => r.json()).then((d) => {
      if (!cancelled) setBalanceSheet(d[symbol] ?? null);
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

  const price = ticker?.price ?? tradfiQuote?.price ?? pair?.price ?? 0;
  const change = ticker?.change ?? tradfiQuote?.change ?? pair?.change ?? 0;
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
          price={price}
          priceChange={change}
          cashflow={cashflow}
          balanceSheet={balanceSheet}
          futures={futures}
          indicators={indicators}
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={handleTimeframeChange}
          onResultChange={setAiRecommendation}
          onLoadingChange={setAiRecommendationLoading}
        />
      </div>

      {/* Column 2: Derivatives & Cashflow */}
      <div className="xl:col-span-4 flex flex-col gap-4">
        {futures && (
          <Card title="Perpetual Futures" icon="⚡">
            <StatRow label="Funding Rate" value={futures.fundingRate} />
            <StatRow label="Open Interest" value={futures.openInterest} last />
          </Card>
        )}

        {/* Long/Short bar */}
        <div className="glass-card p-4 flex flex-col gap-3 transition-all duration-300 hover:scale-[1.01] hover:shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium" style={{ color: "var(--text-3)" }}>Long / Short</p>
            <span className="px-2 py-1 rounded-md text-[10px] font-semibold transition-all duration-200 hover:scale-105" style={{ background: "rgba(52, 211, 153, 0.12)", color: "var(--green)", border: "1px solid rgba(52, 211, 153, 0.2)", boxShadow: "0 0 10px rgba(52, 211, 153, 0.1)" }}>
              +18% Skew
            </span>
          </div>
          <div className="flex rounded-full overflow-hidden h-2.5 transition-all duration-300" style={{ background: "var(--border)" }}>
            <div className="transition-all duration-500" style={{ width: "59%", background: "linear-gradient(90deg, #34d399, #22d3ee)", boxShadow: "0 0 12px var(--green-glow)" }} />
            <div className="transition-all duration-500" style={{ width: "41%", background: "linear-gradient(90deg, #f87171, #fb923c)", boxShadow: "0 0 12px var(--red-glow)" }} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-medium">
            <div className="rounded-xl px-3 py-2 transition-all duration-200 hover:scale-[1.02] hover:shadow-md" style={{ background: "rgba(52, 211, 153, 0.08)", border: "1px solid rgba(52, 211, 153, 0.14)" }}>
              <span style={{ color: "var(--green)" }}>59% Long</span>
            </div>
            <div className="rounded-xl px-3 py-2 text-right transition-all duration-200 hover:scale-[1.02] hover:shadow-md" style={{ background: "rgba(248, 113, 113, 0.08)", border: "1px solid rgba(248, 113, 113, 0.14)" }}>
              <span style={{ color: "var(--red)" }}>41% Short</span>
            </div>
          </div>
        </div>

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
              <DetailPill label="Total Mkt Cap" value={global?.totalMarketCap ?? "—"} />
              <DetailPill label="BTC Dom." value={global?.btcDominance ?? "—"} signal="Bullish" />
              <DetailPill label="ETH Dom." value={global?.ethDominance ?? "—"} />
            </div>
          </div>
        </Card>

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
              <DetailPill label="Max Supply" value={balanceSheet?.maxSupply ? formatSupply(balanceSheet.maxSupply, symbol) : "—"} />
            </div>
          </div>
        </Card>

        <Card title="Cashflow Statement" icon="💰">
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
              <DetailPill label="Revenue (24h)" value={cashflow?.revenue24h ? formatVolume(cashflow.revenue24h) : "—"} signal="Bearish" />
              <DetailPill label="Fees (7d)" value={cashflow?.fees7d ? formatVolume(cashflow.fees7d) : "—"} />
              <DetailPill label="Revenue (30d)" value={cashflow?.revenue30d ? formatVolume(cashflow.revenue30d) : "—"} />
            </div>
          </div>
        </Card>

        <PatternCard timeframe={indicators?.timeframe || "1H"} pattern={indicators?.candlestickPattern} matches={indicators?.candlestickMatches} />

        <ChartPatternCard timeframe={indicators?.timeframe || "1H"} pattern={indicators?.chartPattern} matches={indicators?.chartPatternMatches} />

        <div className="md:col-span-2 xl:col-span-3">
          <MultiTimeframeIndicatorsCard key={symbol} indicators={indicators?.multiTimeframes} consensusScore={indicators?.consensusScore} />
        </div>

        <div className="md:col-span-2 xl:col-span-2">
          <NewsFeed symbol={symbol} />
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
          <span>Range</span>
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
                  <MetricBlock label="Range" value={item.timeframe} strong />
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
                  <div className="mt-3 pt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <DetailPill label="Trend Bias" value={item.available ? item.trendSignal : "Unavailable"} signal={item.available ? item.trendSignal : undefined} />
                    <DetailPill label="Candlestick" value={item.available ? item.candlestickPattern?.name || "No Clear Pattern" : "Unavailable"} signal={item.available ? item.candlestickPattern?.bias : undefined} />
                    <DetailPill label="Chart Pattern" value={item.available ? item.chartPattern?.name || "No Clear Chart Pattern" : "Unavailable"} signal={item.available ? item.chartPattern?.bias : undefined} />
                    <DetailPill label="Status" value={item.available ? "Live" : "Unavailable"} signal={item.available ? "Bullish" : undefined} />
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
