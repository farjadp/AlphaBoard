"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import AssetTabs from "./AssetTabs";
import SessionBand from "./SessionBand";
import PriceChart, { type ChartLevel } from "./PriceChart";
import TradeTicket, { type AlertState, type PlanSource } from "./TradeTicket";
import TimeframeLadder from "./TimeframeLadder";
import { FundamentalsStrip, FuturesPanel, MarketStatsPanel, NewsPanel, PatternsPanel } from "./EvidencePanels";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useBinanceTickers } from "@/hooks/useBinanceTickers";
import { useTradfiQuotes } from "@/hooks/useTradfiQuotes";
import { useCandles } from "@/hooks/useCandles";
import { invalidateSignals, useSignalHistory } from "@/hooks/useSignalHistory";
import { trackRecord } from "@/lib/eval/trackRecord";
import { useAlerts } from "@/hooks/useAlerts";
import { formatPrice, formatVolume } from "@/lib/binance";
import { findAsset } from "@/lib/assetCatalog";
import { hasLegacyData, useHydrated } from "@/lib/client/legacy";
import { pricePrecision, signedPct } from "@/lib/format";
import { alertCondition } from "@/lib/market/tradePlan";
import { REPORT_TIMEFRAMES, type TimeframeKey } from "@/lib/market/timeframes";
import type { IndicatorReport } from "@/lib/market/report";
import type { FuturesSnapshot } from "@/lib/market/futures";
import type { BalanceSheet, Cashflow, GlobalMarket } from "@/lib/market/fundamentals";
import { AI_ERROR_HINTS, type AnalysisResult } from "@/lib/types/analysis";

const TF_LABEL: Record<TimeframeKey, string> = { "1M": "1Mo", "1W": "1W", "1D": "1D", "4H": "4H", "1H": "1H", "15M": "15m", "5M": "5m" };
// Shortest first, the way traders read a timeframe switcher.
const TF_OPTIONS = [...REPORT_TIMEFRAMES].reverse();

function useJson<T>(url: string | null, pick: (body: Record<string, unknown>) => T | null, refreshMs?: number): T | null | undefined {
  const [state, setState] = useState<{ url: string | null; value: T | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const load = () => fetch(url)
      .then((r) => (r.ok ? r.json() : {}))
      .then((body) => { if (!cancelled) setState({ url, value: pick(body) }); })
      .catch(() => { if (!cancelled) setState({ url, value: null }); });
    void load();
    const id = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => { cancelled = true; if (id) clearInterval(id); };
    // `pick` is a stable selector per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, refreshMs]);
  if (!url) return null;
  return state?.url === url ? state.value : undefined;
}

export default function MarketScreen({ symbol }: { symbol: string }) {
  const asset = findAsset(symbol);
  const isCrypto = asset?.category === "crypto";
  const { watchlist } = useWatchlist();
  const [timeframe, setTimeframe] = useState<TimeframeKey>(isCrypto ? "1H" : "1D");

  // ─── Live price ──────────────────────────────────────────────
  const binanceSymbols = useMemo(() => Array.from(new Set([
    ...watchlist.filter((a) => a.binanceSymbol).map((a) => a.binanceSymbol!),
    ...(asset?.binanceSymbol ? [asset.binanceSymbol] : []),
  ])), [watchlist, asset]);
  const { tickers, connected } = useBinanceTickers(binanceSymbols);
  const tradfiSymbols = useMemo(() => Array.from(new Set([
    ...watchlist.filter((a) => a.yahooSymbol).map((a) => a.symbol),
    ...(asset?.yahooSymbol ? [symbol] : []),
  ])), [watchlist, asset, symbol]);
  const tradfiQuotes = useTradfiQuotes(tradfiSymbols, 60_000);
  const ticker = asset?.binanceSymbol ? tickers[asset.binanceSymbol] : undefined;
  const quote = tradfiQuotes[symbol];
  const price = ticker?.price ?? quote?.price;
  const change = ticker?.change ?? quote?.change;
  const high = ticker?.high ?? (quote?.high || undefined);
  const low = ticker?.low ?? (quote?.low || undefined);
  const volume = ticker?.volume ?? (quote?.volume || undefined);

  // ─── Market data ─────────────────────────────────────────────
  const candles = useCandles(symbol, timeframe, 60_000);
  const report = useJson<IndicatorReport>(
    `/api/indicators?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`,
    (b) => (b.error ? null : (b as unknown as IndicatorReport)), 120_000,
  );
  const enc = encodeURIComponent(symbol);
  const futures = useJson<FuturesSnapshot>(isCrypto ? `/api/futures?symbol=${enc}` : null, (b) => (b.futures as FuturesSnapshot) ?? null, 60_000);
  const balance = useJson<BalanceSheet>(isCrypto ? `/api/balancesheet?symbol=${enc}` : null, (b) => (b.balanceSheet as BalanceSheet) ?? null);
  const cashflow = useJson<Cashflow>(isCrypto ? `/api/cashflow?symbol=${enc}` : null, (b) => (b.cashflow as Cashflow) ?? null);
  const global = useJson<GlobalMarket>(isCrypto ? "/api/global" : null, (b) => (b.global as GlobalMarket) ?? null);

  // ─── Strategy ────────────────────────────────────────────────
  const [fresh, setFresh] = useState<{ timeframe: TimeframeKey; result: AnalysisResult } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const { history } = useSignalHistory();
  const record = useMemo(() => trackRecord(history, symbol, timeframe), [history, symbol, timeframe]);
  const archived = useMemo(() => history
    .filter((s) => s.symbol === symbol && s.timeframe.toUpperCase() === timeframe)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null, [history, symbol, timeframe]);
  const source = useMemo<PlanSource | null>(() => (fresh?.timeframe === timeframe
    ? { kind: "fresh", result: fresh.result }
    : archived ? { kind: "archived", signal: archived } : null), [fresh, archived, timeframe]);
  const canGenerate = Boolean(report?.multiTimeframes?.length) && !analyzing;

  async function generate() {
    setAnalyzing(true);
    setAnalysisError(null);
    const tf = timeframe;
    try {
      // Only the choice is sent; the server gathers price, indicators, news, futures and lessons.
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe: tf }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(AI_ERROR_HINTS[data.code] ?? data.error ?? "The plan could not be generated.");
      setFresh({ timeframe: tf, result: data as AnalysisResult });
      invalidateSignals();
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "The plan could not be generated.");
    } finally {
      setAnalyzing(false);
    }
  }

  function changeTimeframe(next: TimeframeKey) {
    setTimeframe(next);
    setAnalysisError(null);
  }

  // ─── Levels on the chart ─────────────────────────────────────
  const levels = useMemo<ChartLevel[]>(() => {
    if (!source) return [];
    const s = source.kind === "fresh" ? source.result : source.signal;
    const out: ChartLevel[] = [];
    if (s.signal !== "HOLD") {
      if (s.entry > 0) out.push({ price: s.entry, kind: "entry", label: "Entry" });
      if (s.takeProfit > 0) out.push({ price: s.takeProfit, kind: "tp", label: "TP" });
      if (s.stopLoss > 0) out.push({ price: s.stopLoss, kind: "sl", label: "SL" });
    }
    if (source.kind === "fresh" && source.result.supportResistance) {
      source.result.supportResistance.support.slice(0, 2).forEach((p, i) => out.push({ price: p, kind: "support", label: `S${i + 1}` }));
      source.result.supportResistance.resistance.slice(0, 2).forEach((p, i) => out.push({ price: p, kind: "resistance", label: `R${i + 1}` }));
    }
    return out;
  }, [source]);

  // ─── Alerts ──────────────────────────────────────────────────
  const { alerts, addAlert } = useAlerts();
  const planEntry = source ? (source.kind === "fresh" ? source.result.entry : source.signal.entry) : null;
  const existingAlert = planEntry ? alerts.find((a) => a.symbol === symbol && !a.triggered && Math.abs(a.targetPrice - planEntry) < 1e-9) : undefined;
  const alertState: AlertState = existingAlert
    ? { status: "set", condition: existingAlert.condition, price: existingAlert.targetPrice }
    : { status: "none" };
  function setAlert(target: number) {
    if (!price) return;
    void addAlert(symbol, target, alertCondition(price, target));
  }

  const hydrated = useHydrated();
  const showImportBanner = hydrated && hasLegacyData();
  const up = (change ?? 0) >= 0;

  return (
    <div className="flex h-full flex-col">
      <NavBar />
      <main className="flex-1 overflow-y-auto">
        <AssetTabs watchlist={watchlist} selected={symbol} tickers={tickers} tradfiQuotes={tradfiQuotes} />
        <SessionBand />

        {showImportBanner && (
          <div className="mx-4 mb-3 flex md:mx-6 flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-[13px] text-amber">
            <span>This browser still holds AlphaBoard data from an earlier version. Import it so it is saved to your account.</span>
            <Link href="/import" className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-paper">Import now</Link>
          </div>
        )}

        <div className="mx-auto flex max-w-[1680px] flex-col gap-4 px-4 pb-8 md:px-6">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section aria-label={`${symbol} price chart`} className="panel flex min-w-0 flex-col gap-3 p-4 md:p-5">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <h1 className="font-display text-2xl font-extrabold leading-none">{symbol}</h1>
                <span className="num text-2xl font-semibold leading-none tracking-tight">{price ? formatPrice(price) : "—"}</span>
                {change !== undefined && price ? (
                  <span className={`num rounded-full px-2.5 py-0.5 text-xs font-semibold ${up ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>{signedPct(change)}</span>
                ) : null}
                <span className="text-[12px] text-ink-3">
                  {asset?.name} · {isCrypto ? (connected ? "live from Binance" : "connecting…") : "Yahoo Finance, refreshed every minute"}
                </span>
                <div role="group" aria-label="Timeframe" className="ml-auto flex rounded-lg border border-line bg-wash p-0.5">
                  {TF_OPTIONS.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      aria-pressed={tf === timeframe}
                      onClick={() => changeTimeframe(tf)}
                      className={`rounded-md px-3 py-1 font-mono text-xs font-semibold ${tf === timeframe ? "bg-paper text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
                    >
                      {TF_LABEL[tf]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative h-[320px] md:h-[420px]">
                {candles.candles.length > 0 && (
                  <PriceChart candles={candles.candles} levels={levels} precision={pricePrecision(price ?? candles.candles.at(-1)?.close)} />
                )}
                {candles.candles.length === 0 && candles.status === "loading" && <div className="skeleton absolute inset-0" aria-label="Loading chart" />}
                {candles.candles.length === 0 && candles.status === "error" && (
                  <div className="absolute inset-0 grid place-items-center rounded-lg bg-wash text-[13px] text-ink-3">{candles.error}</div>
                )}
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
                <Legend className="border-accent border-solid" label="Entry" />
                <Legend className="border-up border-dashed" label="Take profit" />
                <Legend className="border-down border-dashed" label="Stop" />
                <Legend className="border-ink-3 border-dotted" label="Support / resistance" />
                {volume ? <span className="ml-auto text-ink-3">24h volume <span className="num">{formatVolume(volume)}</span></span> : null}
              </div>
            </section>

            <TradeTicket
              timeframeLabel={TF_LABEL[timeframe]}
              source={source}
              price={price}
              loading={analyzing}
              error={analysisError}
              canGenerate={canGenerate}
              onGenerate={generate}
              alert={alertState}
              onSetAlert={setAlert}
              record={record}
              symbol={symbol}
              timeframe={timeframe}
            />
          </div>

          <TimeframeLadder frames={report === undefined ? undefined : report?.multiTimeframes ?? []} consensus={report?.consensusScore} current={timeframe} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_1.3fr]">
            <PatternsPanel timeframe={TF_LABEL[timeframe]} candle={report?.candlestickPattern} chart={report?.chartPattern} loading={report === undefined} />
            {isCrypto
              ? <FuturesPanel futures={futures} />
              : <MarketStatsPanel high={high} low={low} volume={volume} source="Yahoo Finance" />}
            <NewsPanel symbol={symbol} />
          </div>

          {isCrypto && <FundamentalsStrip symbol={symbol} balance={balance ?? null} cashflow={cashflow ?? null} global={global ?? null} />}
        </div>
      </main>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-4 border-t-2 ${className}`} aria-hidden="true" />
      {label}
    </span>
  );
}
