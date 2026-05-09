"use client";

import { useState, useEffect } from "react";
import { useSignalHistory } from "@/hooks/useSignalHistory";

interface AiAnalysisProps {
  symbol: string;
  price: number;
  priceChange: number;
  cashflow: any;
  balanceSheet: any;
  futures: any;
  indicators: any;
}

interface AnalysisResult {
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  timeframe: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  indicators_breakdown?: Array<{
    name: string;
    value: string;
    signal: "Bullish" | "Bearish" | "Neutral";
    explanation: string;
  }>;
}

export default function AiAnalysis({ symbol, price, priceChange, cashflow, balanceSheet, futures, indicators }: AiAnalysisProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { archiveSignal } = useSignalHistory();

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const newsRes = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`);
      let news: string[] = [];
      if (newsRes.ok) {
        const newsData = await newsRes.json();
        news = newsData.items ? newsData.items.map((i: any) => i.headline).slice(0, 3) : [];
      }

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, price, priceChange, cashflow, balanceSheet, futures, indicators, news }),
      });
      if (!res.ok) throw new Error("Failed to fetch AI analysis");
      const data = await res.json();
      setResult(data);
      
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
        reasoning: data.reasoning,
        indicators_breakdown: data.indicators_breakdown,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card overflow-hidden p-5">
      <div className="flex items-center justify-between mb-5">
        <span className="text-sm font-bold" style={{ color: "var(--text)" }}>Strategy Report</span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{
          background: "var(--accent-dim)", color: "var(--accent)", letterSpacing: "0.05em",
        }}>AI CORE</span>
      </div>

      {!result && !loading && (
        <button onClick={handleAnalyze} className="glow-btn w-full py-3 text-xs font-semibold tracking-wide">
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
          <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>Signal ({result.timeframe})</p>
              <span className="text-sm font-bold px-2.5 py-1 rounded-md" style={{
                background: result.signal === "BUY" ? "var(--green-bg)" : result.signal === "SELL" ? "var(--red-bg)" : "var(--surface-2)",
                color: result.signal === "BUY" ? "var(--green)" : result.signal === "SELL" ? "var(--red)" : "var(--text)",
              }}>{result.signal}</span>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>Confidence</p>
              <span className="text-lg font-bold tabular-nums" style={{
                color: result.confidence > 60 ? "var(--green)" : result.confidence < 40 ? "var(--red)" : "var(--text)",
              }}>{result.confidence}%</span>
            </div>
          </div>

          <p className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>{result.reasoning}</p>

          <div className="h-px w-full" style={{ background: "var(--border)" }} />

          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text)" }}>Execution Plan</h4>
            <div className="grid grid-cols-3 gap-2">
              <InfoRow label="Entry" value={result.entry} />
              <InfoRow label="Take Profit" value={result.takeProfit} color="var(--green)" />
              <InfoRow label="Stop Loss" value={result.stopLoss} color="var(--red)" />
            </div>
          </div>

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

function InfoRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className="text-sm font-bold tabular-nums" style={{ color: color || "var(--text)" }}>${value}</p>
    </div>
  );
}
