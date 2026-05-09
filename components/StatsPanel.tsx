"use client";

import { useEffect, useState } from "react";
import { PAIRS } from "@/lib/mockData";
import { formatPrice, formatVolume, formatSupply, pairToSymbol } from "@/lib/binance";
import type { BinanceTicker } from "@/lib/binance";
import type { TradfiQuote } from "@/hooks/useTradfiQuotes";
import AiAnalysis from "./AiAnalysis";
import NewsFeed from "./NewsFeed";

interface FuturesData { fundingRate: string; openInterest: string; }
interface GlobalData { btcDominance: string; ethDominance: string; totalMarketCap: string; }
interface CashflowData { fees24h: number | null; fees7d: number | null; fees30d: number | null; revenue24h: number | null; revenue7d: number | null; revenue30d: number | null; }
interface BalanceSheetData { marketCap: number | null; fdv: number | null; circulatingSupply: number | null; maxSupply: number | null; }
interface IndicatorsData { rsi: number; rsiSignal: string; macd: any; macdSignal: string; sma50: number; smaSignal: string; ema20: number; emaSignal: string; bollingerBands: any; bbSignal: string; }

interface StatsPanelProps { symbol: string; ticker?: BinanceTicker; tradfiQuote?: TradfiQuote; }

export default function StatsPanel({ symbol, ticker, tradfiQuote }: StatsPanelProps) {
  const pair = PAIRS.find((p) => p.symbol === symbol);
  const [futures, setFutures] = useState<FuturesData | null>(null);
  const [global, setGlobal] = useState<GlobalData | null>(null);
  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [indicators, setIndicators] = useState<IndicatorsData | null>(null);

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
        if (!premRes.ok || !oiRes.ok) return;
        const prem = await premRes.json();
        const oi = await oiRes.json();
        if (cancelled) return;
        const rate = (parseFloat(prem.lastFundingRate) * 100).toFixed(4) + "%";
        const oiVal = formatVolume(parseFloat(oi.openInterest) * (ticker?.price ?? 0));
        setFutures({ fundingRate: rate, openInterest: oiVal });
      } catch { /* not all pairs have perpetuals */ }
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
    fetch("/api/cashflow").then((r) => r.json()).then((d) => { if (!cancelled && d[symbol]) setCashflow(d[symbol]); }).catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/balancesheet").then((r) => r.json()).then((d) => { if (!cancelled && d[symbol]) setBalanceSheet(d[symbol]); }).catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/indicators?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((d) => { if (!cancelled && !d.error) setIndicators(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  const price = ticker?.price ?? tradfiQuote?.price ?? pair?.price ?? 0;
  const change = ticker?.change ?? tradfiQuote?.change ?? pair?.change ?? 0;
  const high = ticker?.high ?? (tradfiQuote?.high || undefined);
  const low = ticker?.low ?? (tradfiQuote?.low || undefined);
  const volume = ticker?.volume ?? (tradfiQuote?.volume || undefined);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start w-full">
      {/* Column 1: Fundamentals */}
      <div className="flex flex-col gap-4">
        <Card title="Market Stats" icon="📊">
          <StatRow label="24h High" value={high ? formatPrice(high) : "—"} />
          <StatRow label="24h Low" value={low ? formatPrice(low) : "—"} />
          <StatRow label="24h Volume" value={volume ? formatVolume(volume) : "—"} />
          <StatRow label="Total Mkt Cap" value={global?.totalMarketCap ?? "—"} />
          <StatRow label="BTC Dom." value={global?.btcDominance ?? "—"} />
          <StatRow label="ETH Dom." value={global?.ethDominance ?? "—"} last />
        </Card>

        <Card title="Balance Sheet" icon="🏦">
          <StatRow label="Market Cap" value={balanceSheet?.marketCap ? formatVolume(balanceSheet.marketCap) : "—"} />
          <StatRow label="Fully Diluted Val." value={balanceSheet?.fdv ? formatVolume(balanceSheet.fdv) : "—"} />
          <StatRow label="Circulating Supply" value={balanceSheet?.circulatingSupply ? formatSupply(balanceSheet.circulatingSupply, symbol) : "—"} />
          <StatRow label="Total Supply" value={balanceSheet?.maxSupply ? formatSupply(balanceSheet.maxSupply, symbol) : "—"} last />
        </Card>

        <Card title="Technical Indicators (1H)" icon="📈">
          <StatRow label={`RSI (14) — ${indicators?.rsiSignal || "—"}`} value={indicators?.rsi ? indicators.rsi.toFixed(2) : "—"} signal={indicators?.rsiSignal} />
          <StatRow label={`MACD — ${indicators?.macdSignal || "—"}`} value={indicators?.macd?.MACD ? indicators.macd.MACD.toFixed(2) : "—"} signal={indicators?.macdSignal} />
          <StatRow label={`SMA (50) — ${indicators?.smaSignal || "—"}`} value={indicators?.sma50 ? formatPrice(indicators.sma50) : "—"} signal={indicators?.smaSignal} />
          <StatRow label={`EMA (20) — ${indicators?.emaSignal || "—"}`} value={indicators?.ema20 ? formatPrice(indicators.ema20) : "—"} signal={indicators?.emaSignal} />
          <StatRow label={`B-Bands — ${indicators?.bbSignal || "—"}`} value={indicators?.bollingerBands ? `${formatPrice(indicators.bollingerBands.lower)} – ${formatPrice(indicators.bollingerBands.upper)}` : "—"} last />
        </Card>
      </div>

      {/* Column 2: Derivatives & Cashflow */}
      <div className="flex flex-col gap-4">
        {futures && (
          <Card title="Perpetual Futures" icon="⚡">
            <StatRow label="Funding Rate" value={futures.fundingRate} />
            <StatRow label="Open Interest" value={futures.openInterest} last />
          </Card>
        )}

        {/* Long/Short bar */}
        <div className="glass-card p-4">
          <p className="text-xs font-medium mb-3" style={{ color: "var(--text-3)" }}>Long / Short</p>
          <div className="flex rounded-full overflow-hidden h-2" style={{ background: "var(--border)" }}>
            <div style={{ width: "59%", background: "linear-gradient(90deg, #34d399, #22d3ee)", boxShadow: "0 0 12px var(--green-glow)" }} />
            <div style={{ width: "41%", background: "linear-gradient(90deg, #f87171, #fb923c)", boxShadow: "0 0 12px var(--red-glow)" }} />
          </div>
          <div className="flex justify-between mt-2 text-xs font-medium">
            <span style={{ color: "var(--green)" }}>59% Long</span>
            <span style={{ color: "var(--red)" }}>41% Short</span>
          </div>
        </div>

        <Card title="Cashflow Statement" icon="💰">
          <StatRow label="24h Fees" value={cashflow?.fees24h ? formatVolume(cashflow.fees24h) : "—"} />
          <StatRow label="24h Revenue" value={cashflow?.revenue24h ? formatVolume(cashflow.revenue24h) : "—"} />
          <StatRow label="7d Fees" value={cashflow?.fees7d ? formatVolume(cashflow.fees7d) : "—"} />
          <StatRow label="30d Revenue" value={cashflow?.revenue30d ? formatVolume(cashflow.revenue30d) : "—"} last />
        </Card>
      </div>

      {/* Column 3: AI & News */}
      <div className="flex flex-col gap-4">
        <AiAnalysis symbol={symbol} price={price} priceChange={change} cashflow={cashflow} balanceSheet={balanceSheet} futures={futures} indicators={indicators} />
        <NewsFeed symbol={symbol} />
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
        {icon && <span style={{ fontSize: "12px" }}>{icon}</span>}
        <span className="text-xs font-semibold" style={{ color: "var(--text-2)" }}>{title}</span>
      </div>
      {children}
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
