"use client";

import Link from "next/link";
import NavBar from "@/components/NavBar";
import { useSignalHistory, ArchivedSignal } from "@/hooks/useSignalHistory";
import { formatPrice } from "@/lib/binance";
import OutcomeBadge from "@/components/performance/OutcomeBadge";

export default function AlertsPage() {
  const { history, clearHistory, removeSignal } = useSignalHistory();

  return (
    <div className="min-h-full bg-page">
      <NavBar />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between animate-fade-up">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-ink">Strategy Archive</h1>
            <p className="mt-1 text-sm text-ink-3">Historical AI signals and generated trade plans</p>
          </div>

          {history.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm("Are you sure you want to clear all history?")) clearHistory();
              }}
              className="cursor-pointer rounded-lg border border-line-2 px-4 py-2 text-xs font-bold text-down hover:bg-down-soft"
            >
              Clear Archive
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="panel flex flex-col items-center justify-center p-12 text-center animate-fade-up">
            <h3 className="mb-2 text-lg font-bold text-ink">No Archived Strategies</h3>
            <p className="text-sm text-ink-3">
              Generate an Advanced Strategy from the dashboard, and it will be saved here automatically with a precise timestamp.
            </p>
          </div>
        ) : (
          <div className="space-y-4 animate-fade-up [animation-delay:100ms]">
            {history.map((item) => (
              <HistoryCard key={item.id} item={item} onRemove={() => removeSignal(item.id)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function HistoryCard({ item, onRemove }: { item: ArchivedSignal, onRemove: () => void }) {
  const date = new Date(item.timestamp);

  // Format precisely: e.g. "May 09, 2026 • 16:44:39"
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const formattedTime = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const signalClass =
    item.signal === "BUY" ? "bg-up-soft text-up" : item.signal === "SELL" ? "bg-down-soft text-down" : "bg-wash text-ink";

  return (
    <div className="panel group relative p-5">
      <button
        onClick={onRemove}
        className="absolute right-4 top-4 cursor-pointer rounded-md p-1.5 text-ink-3 opacity-0 transition-opacity hover:bg-down-soft hover:text-down group-hover:opacity-100"
        title="Delete"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
      </button>

      <div className="flex flex-col items-start gap-5 md:flex-row">
        {/* Left Col: Header & Basics */}
        <div className="min-w-[200px] shrink-0">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-bold text-ink">{item.symbol}</span>
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${signalClass}`}>
              {item.signal} ({item.timeframe})
            </span>
          </div>
          {item.evaluation && (
            <div className="mb-3">
              <OutcomeBadge status={item.evaluation.status} rMultiple={item.evaluation.rMultiple} note={item.evaluation.note} />
            </div>
          )}

          <div className="mb-4 space-y-1 text-[11px] text-ink-3">
            <div>{formattedDate}</div>
            <div className="num">{formattedTime}</div>
          </div>

          <div>
            <p className="label-caps mb-0.5">Price at Generation</p>
            <p className="num mb-4 text-sm font-medium text-ink">{formatPrice(item.price)}</p>
          </div>

          <Link
            href={`/journal?symbol=${encodeURIComponent(item.symbol)}&position=${item.signal === "BUY" ? "LONG" : "SHORT"}&entry=${item.entry}&exit=${item.takeProfit}`}
            className="inline-flex w-full items-center justify-center rounded-lg border border-line-2 py-2 text-[10px] font-bold uppercase tracking-wider text-ink hover:bg-wash"
          >
            Log to Journal
          </Link>
          {item.signal !== "HOLD" && (
            <Link
              href={`/paper?signal=${encodeURIComponent(item.id)}`}
              className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-ink py-2 text-[10px] font-bold uppercase tracking-wider text-paper hover:bg-[#23313f]"
            >
              Trade on paper
            </Link>
          )}
        </div>

        {/* Mid Col: Execution Plan */}
        <div className="flex-1 border-l border-line pl-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink">Execution Plan</h4>
            <div className="flex items-center gap-2">
              <span className="label-caps">Confidence</span>
              <span className={`num text-sm font-bold ${item.confidence > 60 ? "text-up" : "text-ink"}`}>{item.confidence}%</span>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3">
            <div>
              <p className="label-caps mb-0.5">Entry</p>
              <p className="num text-sm font-bold text-ink">${item.entry}</p>
            </div>
            <div>
              <p className="label-caps mb-0.5">Take Profit</p>
              <p className="num text-sm font-bold text-up">${item.takeProfit}</p>
            </div>
            <div>
              <p className="label-caps mb-0.5">Stop Loss</p>
              <p className="num text-sm font-bold text-down">${item.stopLoss}</p>
            </div>
          </div>

          <div className="mb-4 rounded-lg bg-wash p-3">
            <p className="text-xs leading-relaxed text-ink-2">{item.reasoning}</p>
          </div>

          {item.risk_management && (
            <div className="mb-4 space-y-3 border-t border-line pt-4">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink">Risk & Sizing</h4>

              <div className="mb-2 grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 rounded-lg bg-wash p-2.5">
                  <p className="label-caps">Leverage</p>
                  <p className="num text-sm font-bold text-amber">{item.risk_management.leverage}</p>
                  <p className="mt-0.5 text-[10px] leading-tight text-ink-2">{item.risk_management.leverageReasoning}</p>
                </div>
                <div className="flex flex-col gap-1 rounded-lg bg-wash p-2.5">
                  <p className="label-caps">Position Size</p>
                  <p className="num text-sm font-bold text-ink">{item.risk_management.positionSize}</p>
                  <p className="mt-0.5 text-[10px] leading-tight text-ink-2">{item.risk_management.sizeReasoning}</p>
                </div>
              </div>

              <div className="num flex items-center gap-4 rounded-lg bg-wash p-2 text-[10px]">
                <div><span className="text-ink-3">R:R Ratio:</span> <span className="text-ink">{item.risk_management.riskRewardRatio}</span></div>
                <div><span className="text-ink-3">Distance:</span> <span className="text-ink">{item.risk_management.distanceToTarget}</span></div>
              </div>
            </div>
          )}

          {item.indicators_breakdown && item.indicators_breakdown.length > 0 && (
            <div className="border-t border-line pt-4">
              <h4 className="label-caps mb-3">Indicator Breakdown</h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {item.indicators_breakdown.map((ind, idx) => (
                  <div key={idx} className="flex flex-col gap-1 rounded-lg bg-wash p-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${ind.signal === "Bullish" ? "bg-up" : ind.signal === "Bearish" ? "bg-down" : "bg-ink-3"}`}
                        />
                        <span className="text-[10px] font-bold text-ink">{ind.name}</span>
                      </div>
                      <span className="num text-[9px] text-ink-3">{ind.value}</span>
                    </div>
                    <p className="text-[10px] leading-snug text-ink-2">{ind.explanation}</p>
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
