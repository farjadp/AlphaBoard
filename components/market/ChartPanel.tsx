"use client";

import PriceChart, { type ChartLevel, type ChartStudies } from "./PriceChart";
import { useChartPrefs, type ChartView } from "@/lib/client/chartPrefs";
import TradingViewChart from "./TradingViewChart";
import type { CandlesState } from "@/lib/client/hooks/useCandles";
import { useLiveBar } from "@/lib/client/hooks/useLiveBar";
import type { Asset } from "@/lib/market/catalog";
import type { TimeframeKey } from "@/lib/market/timeframes";
import { tradingViewInterval, tradingViewSymbol } from "@/lib/market/tradingview";
import { pricePrecision } from "@/lib/format";

interface ChartPanelProps {
  asset: Asset | undefined;
  timeframe: TimeframeKey;
  candles: CandlesState;
  levels: ChartLevel[];
  price: number | undefined;
}

/** The chart area: AlphaBoard's own chart (plan levels, live bar, studies) or TradingView's widget. */
export default function ChartPanel({ asset, timeframe, candles, levels, price }: ChartPanelProps) {
  const [prefs, setPrefs] = useChartPrefs();
  const { view, studies } = prefs;
  const setView = (v: ChartView) => setPrefs({ ...prefs, view: v });

  const tvSymbol = asset ? tradingViewSymbol(asset) : null;
  const live = useLiveBar(view === "plan" ? asset?.binanceSymbol : undefined, timeframe);
  const showTv = view === "tradingview" && tvSymbol;

  const toggle = (k: keyof ChartStudies) => setPrefs({ ...prefs, studies: { ...studies, [k]: !studies[k] } });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Chart" className="seg">
          <button type="button" role="tab" aria-selected={view === "plan"} onClick={() => setView("plan")} className="seg-item">
            AlphaBoard
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "tradingview"}
            disabled={!tvSymbol}
            title={tvSymbol ? "TradingView chart with drawing tools and indicators" : "TradingView has no free feed for this market"}
            onClick={() => setView("tradingview")}
            className="seg-item"
          >
            TradingView
          </button>
        </div>
        {!showTv && (
          <div role="group" aria-label="Studies" className="flex items-center gap-1">
            {([["volume", "Vol"], ["ema20", "EMA 20"], ["ema50", "EMA 50"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={studies[k]} onClick={() => toggle(k)} className="chip">
                {label}
              </button>
            ))}
          </div>
        )}
        {!showTv && asset?.binanceSymbol && (
          <span className={`ml-auto flex items-center gap-1.5 text-[12px] ${live.connected ? "text-up" : "text-ink-3"}`}>
            <span aria-hidden className={`size-1.5 rounded-full ${live.connected ? "live-dot bg-up" : "bg-ink-3"}`} />
            {live.connected ? "Live candle" : "Connecting…"}
          </span>
        )}
      </div>

      <div className="relative h-[340px] md:h-[480px]">
        {showTv ? (
          <TradingViewChart symbol={tvSymbol} interval={tradingViewInterval(timeframe)} />
        ) : (
          <>
            {candles.candles.length > 0 && (
              <PriceChart
                candles={candles.candles}
                levels={levels}
                precision={pricePrecision(price ?? candles.candles.at(-1)?.close)}
                live={live.bar}
                studies={studies}
              />
            )}
            {candles.candles.length === 0 && candles.status === "loading" && <div className="skeleton absolute inset-0" aria-label="Loading chart" />}
            {candles.candles.length === 0 && candles.status === "error" && (
              <div className="absolute inset-0 grid place-items-center rounded-lg bg-wash text-[13px] text-ink-3">{candles.error}</div>
            )}
          </>
        )}
      </div>

      {!showTv && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
          {levels.some((l) => l.kind === "entry") && <Legend className="border-accent border-solid" label="Entry" />}
          {levels.some((l) => l.kind === "tp") && <Legend className="border-up border-dashed" label="Take profit" />}
          {levels.some((l) => l.kind === "sl") && <Legend className="border-down border-dashed" label="Stop" />}
          {levels.some((l) => l.kind === "support" || l.kind === "resistance") && <Legend className="border-ink-3 border-dotted" label="Support / resistance" />}
          {studies.ema20 && <Legend className="border-accent border-solid" label="EMA 20" thin />}
          {studies.ema50 && <Legend className="border-amber border-solid" label="EMA 50" thin />}
        </div>
      )}
    </>
  );
}

function Legend({ className, label, thin }: { className: string; label: string; thin?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`inline-block w-5 ${thin ? "border-t" : "border-t-2"} ${className}`} />
      {label}
    </span>
  );
}
