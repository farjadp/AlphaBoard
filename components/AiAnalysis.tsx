"use client";

import { useMemo, useState } from "react";
import { REPORT_TIMEFRAME_OPTIONS, type ReportTimeframe } from "./StatsPanel";
import type { CandlestickPatternMatch } from "@/lib/candlestickPatterns";
import type { ChartPatternMatch } from "@/lib/chartPatterns";
import { useSignalHistory } from "@/hooks/useSignalHistory";
import { getRelevantLessons } from "@/hooks/useTradeLessons";
import PatternMiniVisual from "./PatternMiniVisual";

interface CashflowData { fees24h?: number | null; revenue24h?: number | null; fees7d?: number | null; revenue30d?: number | null; }
interface BalanceSheetData { marketCap?: number | null; fdv?: number | null; }
interface FuturesData { fundingRate?: string; openInterest?: string; }
interface MultiTimeframeIndicator {
  timeframe: string;
  trendSignal: "Bullish" | "Bearish" | "Neutral";
  rsiSignal: string;
  macdSignal: string;
  emaSignal: string;
  available: boolean;
}
interface IndicatorsData {
  timeframe?: string;
  candlestickPattern?: CandlestickPatternMatch;
  chartPattern?: ChartPatternMatch;
  multiTimeframes?: MultiTimeframeIndicator[];
  consensusScore?: {
    bullishPressure: number;
    bearishPressure: number;
    netScore: number;
    dominantBias: "Bullish" | "Bearish" | "Neutral";
    coverage: number;
  };
}

interface AiAnalysisProps {
  symbol: string;
  price: number;
  priceChange: number;
  cashflow: CashflowData | null;
  balanceSheet: BalanceSheetData | null;
  futures: FuturesData | null;
  indicators: IndicatorsData | null;
  selectedTimeframe: ReportTimeframe;
  onTimeframeChange: (timeframe: ReportTimeframe) => void;
  onResultChange?: (result: AnalysisResult | null) => void;
  onLoadingChange?: (loading: boolean) => void;
}

export interface AnalysisResult {
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  timeframe: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  tradeStyle?: string;
  risk_management?: {
    leverage: string;
    leverageReasoning: string;
    positionSize: string;
    sizeReasoning: string;
    riskRewardRatio: string;
    distanceToTarget: string;
  };
  supportResistance?: {
    support: number[];
    resistance: number[];
  };
  safeEntries?: Array<{
    price: number;
    reasoning: string;
  }>;
  reasoning: string;
  indicators_breakdown?: Array<{
    name: string;
    value: string;
    signal: "Bullish" | "Bearish" | "Neutral";
    explanation: string;
  }>;
}

export default function AiAnalysis({ symbol, price, priceChange, cashflow, balanceSheet, futures, indicators, selectedTimeframe, onTimeframeChange, onResultChange, onLoadingChange }: AiAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { archiveSignal } = useSignalHistory();
  const activePattern = indicators?.candlestickPattern;
  const activeChartPattern = indicators?.chartPattern;
  const multiTimeframes = indicators?.multiTimeframes ?? [];
  const consensusScore = indicators?.consensusScore;
  const baseTimeframe = indicators?.timeframe || "1H";
  const bullishCount = multiTimeframes.filter((item) => item.available && item.trendSignal === "Bullish").length;
  const bearishCount = multiTimeframes.filter((item) => item.available && item.trendSignal === "Bearish").length;
  const neutralCount = multiTimeframes.filter((item) => item.available && item.trendSignal === "Neutral").length;
  const analysisReady = useMemo(() => Boolean(indicators?.timeframe && indicators?.multiTimeframes && indicators.multiTimeframes.length > 0), [indicators]);

  async function handleAnalyze() {
    if (!analysisReady || !indicators) {
      setError("Indicator data for the selected asset is still loading. Please wait a moment and try again.");
      return;
    }

    setLoading(true);
    onLoadingChange?.(true);
    setError(null);
    setResult(null);
    onResultChange?.(null);
    try {
      const newsRes = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`);
      let news: string[] = [];
      if (newsRes.ok) {
        const newsData = await newsRes.json() as { items?: Array<{ headline?: string | null }> };
        news = newsData.items ? newsData.items.map((item) => item.headline || "").filter(Boolean).slice(0, 3) : [];
      }

      // Read past lessons to provide context for the AI Engine
      const pastLessons = getRelevantLessons({ symbol, limit: 6 });

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, price, priceChange, cashflow, balanceSheet, futures, indicators, news, selectedTimeframe, pastLessons }),
      });
      if (!res.ok) throw new Error("Failed to fetch AI analysis");
      const data = await res.json();
      setResult(data);
      onResultChange?.(data);
      
      // Archive the signal with exact current time
      archiveSignal({
        symbol,
        price,
        signal: data.signal,
        confidence: data.confidence,
        timeframe: data.timeframe,
        entry: data.entry,
        stopLoss: data.stopLoss,
        takeProfit: data.takeProfit,
        tradeStyle: data.tradeStyle,
        risk_management: data.risk_management,
        reasoning: data.reasoning,
        indicators_breakdown: data.indicators_breakdown,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      onResultChange?.(null);
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  }

  return (
    <div className="glass-card overflow-hidden p-5">
      <div className="mb-5 rounded-2xl p-4 flex flex-col gap-4" style={{ background: "linear-gradient(135deg, rgba(82,170,255,0.1), rgba(168,85,247,0.08))", border: "1px solid var(--border-strong)" }}>
        <div className="flex flex-col gap-3 w-full lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-bold" style={{ color: "var(--text)" }}>Strategy Report</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{
                background: "var(--accent-dim)", color: "var(--accent)", letterSpacing: "0.05em",
              }}>AI CORE</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-2)", border: "1px solid var(--border)" }}>
                Active {selectedTimeframe}
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>
              Clean, timeframe-aware view of patterns, consensus, and execution bias.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 rounded-xl p-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}>
            {REPORT_TIMEFRAME_OPTIONS.map((option) => {
              const active = selectedTimeframe === option.key;
              return (
                <button
                  key={option.key}
                  onClick={() => onTimeframeChange(option.key)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ease-out hover:scale-105 active:scale-95"
                  style={{
                    background: active ? "linear-gradient(135deg, rgba(82,170,255,0.2), rgba(168,85,247,0.18))" : "transparent",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    color: active ? "var(--accent)" : "var(--text-2)",
                    boxShadow: active ? "0 0 18px rgba(82,170,255,0.12)" : "none",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activePattern && (
        <div className="mb-5 p-4 rounded-2xl flex flex-col gap-4" style={{ background: "linear-gradient(135deg, rgba(82, 170, 255, 0.12), rgba(255,255,255,0.03))", border: "1px solid var(--border-strong)" }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] mb-1" style={{ color: "var(--text-3)" }}>Pattern Snapshot</p>
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Primary structures on {baseTimeframe}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PatternStat value={`Candle ${activePattern.confidence}%`} />
              <PatternStat value={`Chart ${activeChartPattern?.confidence ?? 34}%`} />
              {consensusScore && <PatternStat value={`Consensus ${consensusScore.netScore}/100`} />}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
              <PatternMiniVisual pattern={activePattern} variant="candlestick" className="w-20 h-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.18em] mb-1" style={{ color: "var(--text-3)" }}>Candlestick Pattern · {baseTimeframe}</p>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-base font-bold" style={{ color: "var(--text)" }}>{activePattern.name}</span>
                  <PatternToneBadge bias={activePattern.bias} />
                </div>
                <p className="text-sm leading-6 mt-2" style={{ color: "var(--text-2)" }}>{activePattern.description}</p>
              </div>
            </div>

            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
              <PatternMiniVisual pattern={activeChartPattern} variant="chart" className="w-20 h-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.18em] mb-1" style={{ color: "var(--text-3)" }}>Chart Pattern · {baseTimeframe}</p>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-base font-bold" style={{ color: "var(--text)" }}>{activeChartPattern?.name || "No Clear Chart Pattern"}</span>
                  <PatternToneBadge bias={activeChartPattern?.bias || "Neutral"} />
                </div>
                <p className="text-sm leading-6 mt-2" style={{ color: "var(--text-2)" }}>{activeChartPattern?.description || "No dominant chart structure is active in the recent price action."}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {multiTimeframes.length > 0 && (
        <div className="mb-5 p-4 rounded-2xl flex flex-col gap-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] mb-1" style={{ color: "var(--text-3)" }}>Multi-Timeframe Consensus</p>
              <p className="text-sm" style={{ color: "var(--text-2)" }}>
                {bullishCount} bullish
                {" · "}
                {bearishCount} bearish
                {" · "}
                {neutralCount} neutral
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PatternStat value={`${multiTimeframes.length} frames`} />
              {consensusScore && <PatternStat value={`Coverage ${consensusScore.coverage}%`} />}
            </div>
          </div>

          {consensusScore && (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Consensus Score</span>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold tabular-nums" style={{ color: consensusScore.netScore >= 57 ? "var(--green)" : consensusScore.netScore <= 43 ? "var(--red)" : "var(--text)" }}>
                    {consensusScore.netScore}/100
                  </span>
                  <PatternToneBadge bias={consensusScore.dominantBias} />
                </div>
              </div>
              <div className="h-3 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
                <div className="h-full rounded-full" style={{ width: `${consensusScore.bullishPressure}%`, background: "linear-gradient(90deg, #34d399, #22d3ee)" }} />
              </div>
              <div className="flex justify-between text-[11px]" style={{ color: "var(--text-2)" }}>
                <span>Bullish {consensusScore.bullishPressure}%</span>
                <span>Bearish {consensusScore.bearishPressure}%</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {multiTimeframes.map((item) => (
              <TimeframeSignalPill key={item.timeframe} timeframe={item.timeframe} tone={item.available ? item.trendSignal : "Neutral"} available={item.available} />
            ))}
          </div>
        </div>
      )}

      {!result && !loading && (
        <button onClick={handleAnalyze} disabled={!analysisReady} className="glow-btn w-full py-3 text-xs font-semibold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-[1.02] active:scale-95">
          Generate Advanced Strategy
        </button>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <div className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
          <span className="text-xs" style={{ color: "var(--text-3)" }}>Synthesizing strategy…</span>
        </div>
      )}

      {error && (
        <div className="text-xs p-3 rounded-lg mb-2" style={{ background: "var(--red-bg)", color: "var(--red)" }}>{error}</div>
      )}

      {result && !loading && (
        <div className="space-y-4 animate-fade-up">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 rounded-2xl" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))", border: "1px solid var(--border)" }}>
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>Signal ({result.timeframe})</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold px-2.5 py-1 rounded-md" style={{
                  background: result.signal === "BUY" ? "var(--green-bg)" : result.signal === "SELL" ? "var(--red-bg)" : "var(--surface-2)",
                  color: result.signal === "BUY" ? "var(--green)" : result.signal === "SELL" ? "var(--red)" : "var(--text)",
                }}>{result.signal}</span>
                {activePattern && (
                  <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
                    {activePattern.name}
                  </span>
                )}
                {consensusScore && (
                  <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: consensusScore.netScore >= 57 ? "var(--green)" : consensusScore.netScore <= 43 ? "var(--red)" : "var(--text-2)" }}>
                    Consensus {consensusScore.netScore}/100
                  </span>
                )}
              </div>
            </div>
            <div className="md:text-right">
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>Confidence</p>
              <span className="text-lg font-bold tabular-nums" style={{
                color: result.confidence > 60 ? "var(--green)" : result.confidence < 40 ? "var(--red)" : "var(--text)",
              }}>{result.confidence}%</span>
            </div>
          </div>

          <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
            <p className="text-sm leading-7 max-w-4xl" style={{ color: "var(--text-2)" }}>{result.reasoning}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 bg-white/5 p-4 rounded-2xl border border-white/10 mt-4">
            {/* Left Column: Targets */}
            <div className="space-y-3 lg:border-r lg:border-white/10 lg:pr-5">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Targets</h4>
                {result.tradeStyle && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 uppercase">
                    {result.tradeStyle}
                  </span>
                )}
              </div>
              
              <div className="space-y-2 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-gray-500 uppercase">Entry</span>
                  <span className="text-xs font-bold text-white tabular-nums">${result.entry}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-gray-500 uppercase">Target</span>
                  <span className="text-xs font-bold text-green-400 tabular-nums">${result.takeProfit}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-gray-500 uppercase">Stop</span>
                  <span className="text-xs font-bold text-red-400 tabular-nums">${result.stopLoss}</span>
                </div>
              </div>

              {result.risk_management && (
                <div className="pt-2 mt-2 border-t border-white/5 flex justify-between items-center text-[9px] font-mono text-gray-400">
                  <span>R:R {result.risk_management.riskRewardRatio}</span>
                  <span>{result.risk_management.distanceToTarget}</span>
                </div>
              )}
            </div>

            {/* Right Column: Risk */}
            <div className="space-y-3 lg:pl-2">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Risk Profile</h4>
              
              {result.risk_management ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-[10px] text-gray-500 uppercase">Leverage</span>
                      <span className="text-xs font-bold text-yellow-400">{result.risk_management.leverage}</span>
                    </div>
                    <p className="text-[9px] text-gray-400 leading-snug">{result.risk_management.leverageReasoning}</p>
                  </div>
                  
                  <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-[10px] text-gray-500 uppercase">Size</span>
                      <span className="text-xs font-bold text-blue-400">{result.risk_management.positionSize}</span>
                    </div>
                    <p className="text-[9px] text-gray-400 leading-snug">{result.risk_management.sizeReasoning}</p>
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-gray-500 italic">No risk profile generated.</div>
              )}
            </div>
          </div>

          {/* Technical Levels & Safe Entries */}
          {(result.supportResistance || result.safeEntries) && (
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10 mt-4 mb-4 space-y-5">
              
              {result.supportResistance && (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                    <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
                    Support & Resistance Map
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg p-3 border border-red-500/20 bg-red-500/5">
                      <span className="block text-[10px] text-red-400/80 uppercase font-bold mb-2">Resistance Levels</span>
                      <div className="space-y-1.5">
                        {result.supportResistance.resistance.map((r, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-500">R{i + 1}</span>
                            <span className="text-xs font-mono font-bold text-red-300">${r.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg p-3 border border-green-500/20 bg-green-500/5">
                      <span className="block text-[10px] text-green-400/80 uppercase font-bold mb-2">Support Levels</span>
                      <div className="space-y-1.5">
                        {result.supportResistance.support.map((s, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-500">S{i + 1}</span>
                            <span className="text-xs font-mono font-bold text-green-300">${s.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {result.safeEntries && result.safeEntries.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                    <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    Safe Entry Zones
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {result.safeEntries.map((entry, idx) => (
                      <div key={idx} className="rounded-lg p-3 relative overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                        <div className="absolute top-0 right-0 w-8 h-8 flex items-center justify-center opacity-10">
                          <span className="text-2xl font-bold">{idx + 1}</span>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">ENTRY {idx + 1}</span>
                          <span className="text-sm font-mono font-bold text-white">${entry.price.toLocaleString()}</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-relaxed">{entry.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {result.indicators_breakdown && result.indicators_breakdown.length > 0 && (
            <>
              <div className="h-px w-full" style={{ background: "var(--border)" }} />
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text)" }}>Indicator Breakdown</h4>
                <div className="flex flex-col gap-2">
                  {result.indicators_breakdown.map((ind, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg flex flex-col gap-1.5" style={{ background: "var(--surface-2)" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{
                            background: ind.signal === "Bullish" ? "var(--green)" : ind.signal === "Bearish" ? "var(--red)" : "var(--text-3)",
                            boxShadow: ind.signal === "Bullish" ? "0 0 6px var(--green-glow)" : ind.signal === "Bearish" ? "0 0 6px var(--red-glow)" : "none"
                          }} />
                          <span className="text-xs font-bold" style={{ color: "var(--text)" }}>{ind.name}</span>
                        </div>
                        <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded" style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
                          {ind.value}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-2)" }}>{ind.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <button onClick={handleAnalyze}
            className="w-full mt-2 py-2 text-[10px] font-semibold rounded-lg transition-all duration-200 cursor-pointer"
            style={{ border: "1px solid var(--border)", color: "var(--text-2)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border)"; }}
          >Recalculate Strategy</button>
        </div>
      )}
    </div>
  );
}

function PatternToneBadge({ bias }: { bias: "Bullish" | "Bearish" | "Neutral" }) {
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

function PatternStat({ value }: { value: string }) {
  return (
    <span className="px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-all duration-200 hover:scale-105 hover:shadow-md" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
      {value}
    </span>
  );
}

function TimeframeSignalPill({ timeframe, tone, available }: { timeframe: string; tone: "Bullish" | "Bearish" | "Neutral"; available: boolean }) {
  const styles = !available
    ? { background: "var(--surface-2)", color: "var(--text-3)", borderColor: "var(--border)" }
    : tone === "Bullish"
      ? { background: "var(--green-bg)", color: "var(--green)", borderColor: "rgba(52, 211, 153, 0.35)", boxShadow: "0 0 8px rgba(52, 211, 153, 0.1)" }
      : tone === "Bearish"
        ? { background: "var(--red-bg)", color: "var(--red)", borderColor: "rgba(248, 113, 113, 0.35)", boxShadow: "0 0 8px rgba(248, 113, 113, 0.1)" }
        : { background: "rgba(148, 163, 184, 0.08)", color: "#cbd5e1", borderColor: "rgba(148, 163, 184, 0.28)" };

  return (
    <span className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-200 hover:scale-105 cursor-default" style={styles}>
      {timeframe} · {available ? tone : "Unavailable"}
    </span>
  );
}
