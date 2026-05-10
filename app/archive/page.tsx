"use client";

import Link from "next/link";
import NavBar from "@/components/NavBar";
import { useSignalHistory, ArchivedSignal } from "@/hooks/useSignalHistory";
import { formatPrice } from "@/lib/binance";

export default function AlertsPage() {
  const { history, clearHistory, removeSignal } = useSignalHistory();

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <NavBar />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between mb-8 animate-fade-up">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Strategy Archive</h1>
              <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Historical AI signals and generated trade plans</p>
            </div>
            
            {history.length > 0 && (
              <button 
                onClick={() => {
                  if (window.confirm("Are you sure you want to clear all history?")) clearHistory();
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all hover:bg-red-500/10"
                style={{ color: "var(--red)", border: "1px solid var(--red-dim)" }}
              >
                Clear Archive
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="glass-card p-12 text-center flex flex-col items-center justify-center animate-fade-up">
              <span className="text-4xl mb-4 opacity-50">📂</span>
              <h3 className="text-lg font-bold mb-2" style={{ color: "var(--text)" }}>No Archived Strategies</h3>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>
                Generate an Advanced Strategy from the dashboard, and it will be saved here automatically with a precise timestamp.
              </p>
            </div>
          ) : (
            <div className="space-y-4 animate-fade-up" style={{ animationDelay: "100ms" }}>
              {history.map((item) => (
                <HistoryCard key={item.id} item={item} onRemove={() => removeSignal(item.id)} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function HistoryCard({ item, onRemove }: { item: ArchivedSignal, onRemove: () => void }) {
  const date = new Date(item.timestamp);
  
  // Format precisely: e.g. "May 09, 2026 • 16:44:39"
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const formattedTime = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="glass-card p-5 relative group">
      <button 
        onClick={onRemove}
        className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-white/5 text-gray-500 hover:text-red-400 cursor-pointer"
        title="Delete"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
      </button>

      <div className="flex flex-col md:flex-row gap-5 items-start">
        {/* Left Col: Header & Basics */}
        <div className="min-w-[200px] shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{item.symbol}</span>
            <span className="text-xs px-2 py-0.5 rounded-md" style={{
              background: item.signal === "BUY" ? "var(--green-bg)" : item.signal === "SELL" ? "var(--red-bg)" : "var(--surface-2)",
              color: item.signal === "BUY" ? "var(--green)" : item.signal === "SELL" ? "var(--red)" : "var(--text)",
              fontWeight: 600
            }}>{item.signal} ({item.timeframe})</span>
          </div>
          
          <div className="text-[11px] mb-4 space-y-1" style={{ color: "var(--text-3)" }}>
            <div className="flex items-center gap-1.5">
              <span>📅</span> {formattedDate}
            </div>
            <div className="flex items-center gap-1.5 font-mono">
              <span>⏱</span> {formattedTime}
            </div>
          </div>
          
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--text-3)" }}>Price at Generation</p>
            <p className="text-sm font-medium tabular-nums mb-4" style={{ color: "var(--text)" }}>{formatPrice(item.price)}</p>
          </div>

          <Link
            href={`/journal?symbol=${encodeURIComponent(item.symbol)}&position=${item.signal === "BUY" ? "LONG" : "SHORT"}&entry=${item.entry}&exit=${item.takeProfit}`}
            className="inline-flex items-center justify-center w-full py-2 text-[10px] font-bold uppercase tracking-wider rounded-md transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--text-2)", background: "var(--surface-2)" }}
          >
            Log to Journal
          </Link>
        </div>

        {/* Mid Col: Execution Plan */}
        <div className="flex-1 border-l pl-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text)" }}>Execution Plan</h4>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Confidence</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: item.confidence > 60 ? "var(--green)" : "var(--text)" }}>{item.confidence}%</span>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--text-3)" }}>Entry</p>
              <p className="text-sm font-bold tabular-nums" style={{ color: "var(--text)" }}>${item.entry}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--text-3)" }}>Take Profit</p>
              <p className="text-sm font-bold tabular-nums" style={{ color: "var(--green)" }}>${item.takeProfit}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--text-3)" }}>Stop Loss</p>
              <p className="text-sm font-bold tabular-nums" style={{ color: "var(--red)" }}>${item.stopLoss}</p>
            </div>
          </div>
          
          <div className="p-3 rounded-lg mb-4" style={{ background: "var(--surface-2)" }}>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>{item.reasoning}</p>
          </div>
          
          {item.risk_management && (
            <div className="mb-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text)" }}>Risk & Sizing</h4>
              
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="p-2.5 rounded-lg border flex flex-col gap-1" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Leverage</p>
                  <p className="text-sm font-bold font-mono" style={{ color: "var(--yellow)" }}>{item.risk_management.leverage}</p>
                  <p className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--text-2)" }}>{item.risk_management.leverageReasoning}</p>
                </div>
                <div className="p-2.5 rounded-lg border flex flex-col gap-1" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Position Size</p>
                  <p className="text-sm font-bold font-mono" style={{ color: "var(--accent)" }}>{item.risk_management.positionSize}</p>
                  <p className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--text-2)" }}>{item.risk_management.sizeReasoning}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-[10px] font-mono p-2 rounded-lg" style={{ background: "var(--surface-2)" }}>
                <div><span style={{ color: "var(--text-3)" }}>R:R Ratio:</span> <span style={{ color: "var(--text)" }}>{item.risk_management.riskRewardRatio}</span></div>
                <div><span style={{ color: "var(--text-3)" }}>Distance:</span> <span style={{ color: "var(--text)" }}>{item.risk_management.distanceToTarget}</span></div>
              </div>
            </div>
          )}
          
          {item.indicators_breakdown && item.indicators_breakdown.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-3)" }}>Indicator Breakdown</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {item.indicators_breakdown.map((ind, idx) => (
                  <div key={idx} className="p-2 rounded flex flex-col gap-1" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{
                          background: ind.signal === "Bullish" ? "var(--green)" : ind.signal === "Bearish" ? "var(--red)" : "var(--text-3)",
                          boxShadow: ind.signal === "Bullish" ? "0 0 4px var(--green-glow)" : ind.signal === "Bearish" ? "0 0 4px var(--red-glow)" : "none"
                        }} />
                        <span className="text-[10px] font-bold" style={{ color: "var(--text)" }}>{ind.name}</span>
                      </div>
                      <span className="text-[9px] font-mono tabular-nums text-gray-500">{ind.value}</span>
                    </div>
                    <p className="text-[10px] leading-snug" style={{ color: "var(--text-2)" }}>{ind.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
