"use client";

import Link from "next/link";
import NavBar from "@/components/NavBar";
import Sidebar from "@/components/Sidebar";
import StatsPanel from "@/components/StatsPanel";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useBinanceTickers } from "@/hooks/useBinanceTickers";
import { useTradfiQuotes, type TradfiQuote } from "@/hooks/useTradfiQuotes";
import { formatPrice } from "@/lib/binance";
import type { BinanceTicker } from "@/lib/binance";
import { assetHref, findAsset } from "@/lib/assetCatalog";

interface DashboardScreenProps {
  routeSymbol: string;
}

export default function DashboardScreen({ routeSymbol }: DashboardScreenProps) {
  const { watchlist, symbols } = useWatchlist();
  const activeSymbol = findAsset(routeSymbol)?.symbol ?? symbols[0] ?? routeSymbol;
  const asset = findAsset(activeSymbol);

  const cryptoSymbols = Array.from(new Set([
    ...watchlist.filter((item) => item.binanceSymbol).map((item) => item.binanceSymbol!),
    ...(asset?.binanceSymbol ? [asset.binanceSymbol] : []),
  ]));
  const { tickers, connected } = useBinanceTickers(cryptoSymbols);

  const tradfiSymbols = Array.from(new Set([
    ...symbols.filter((symbol) => findAsset(symbol)?.yahooSymbol),
    ...(asset?.yahooSymbol ? [activeSymbol] : []),
  ]));
  const tradfiQuotes = useTradfiQuotes(tradfiSymbols, 60_000);

  const binanceTicker = asset?.binanceSymbol ? tickers[asset.binanceSymbol] : undefined;
  const tradfiQuote = tradfiQuotes[activeSymbol];

  const price = binanceTicker?.price ?? tradfiQuote?.price ?? 0;
  const change = binanceTicker?.change ?? tradfiQuote?.change ?? 0;
  const volume = binanceTicker?.volume ?? (tradfiQuote?.volume || undefined);
  const positive = change >= 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <NavBar connected={connected} />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          selected={activeSymbol}
          tickers={tickers}
          tradfiQuotes={tradfiQuotes}
          watchlist={watchlist}
        />

        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-end justify-between animate-fade-up">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xl">{asset?.icon}</span>
                  <h1 className="text-lg font-bold" style={{ color: "var(--text)" }}>{activeSymbol}</h1>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md capitalize" style={{
                    background: asset?.category === "crypto" ? "var(--accent-dim)" : "var(--yellow-bg)",
                    color: asset?.category === "crypto" ? "var(--accent)" : "var(--yellow)",
                  }}>{asset?.category ?? "market"}</span>
                </div>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>
                  {asset?.name} · {asset?.category === "crypto" ? "Binance" : "Yahoo Finance"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {volume !== undefined && <Pill label="24h Vol" value={fmtVol(volume)} />}
                <Pill
                  label="24h"
                  value={`${positive ? "+" : ""}${change.toFixed(2)}%`}
                  positive={positive}
                  colored
                />
                <div className="px-4 py-2 rounded-xl text-sm tabular-nums font-bold" style={{
                  background: "var(--surface)", border: "1px solid var(--border-strong)", color: "var(--text)",
                  boxShadow: "0 0 20px rgba(0,0,0,0.3)",
                }}>{price > 0 ? formatPrice(price) : "—"}</div>
              </div>
            </div>

            <MarketStrip
              selected={activeSymbol}
              watchlist={watchlist}
              tickers={tickers}
              tradfiQuotes={tradfiQuotes}
            />

            <div className="w-full mt-6 animate-fade-up" style={{ animationDelay: "100ms" }}>
              <StatsPanel
                key={activeSymbol}
                symbol={activeSymbol}
                ticker={binanceTicker}
                tradfiQuote={tradfiQuote}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function fmtVol(usd: number): string {
  if (usd >= 1e12) return "$" + (usd / 1e12).toFixed(1) + "T";
  if (usd >= 1e9) return "$" + (usd / 1e9).toFixed(1) + "B";
  if (usd >= 1e6) return "$" + (usd / 1e6).toFixed(1) + "M";
  return "$" + usd.toFixed(0);
}

function Pill({ label, value, positive, colored }: { label: string; value: string; positive?: boolean; colored?: boolean }) {
  const color = colored ? (positive ? "var(--green)" : "var(--red)") : "var(--text)";
  const bg = colored ? (positive ? "var(--green-bg)" : "var(--red-bg)") : "var(--surface)";

  return (
    <div className="px-3 py-1.5 rounded-lg text-xs" style={{ background: bg, border: "1px solid var(--border)" }}>
      {label && <span className="mr-1.5" style={{ color: "var(--text-3)" }}>{label}</span>}
      <span className="tabular-nums font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

function MarketStrip({ selected, watchlist, tickers, tradfiQuotes }: {
  selected: string;
  watchlist: ReturnType<typeof useWatchlist>["watchlist"];
  tickers: Record<string, BinanceTicker>;
  tradfiQuotes: Record<string, TradfiQuote>;
}) {
  if (watchlist.length === 0) return null;

  return (
    <div className="glass-card overflow-x-auto animate-fade-up" style={{ animationDelay: "50ms" }}>
      <div className="flex">
        {watchlist.map((asset, i) => {
          const live = asset.binanceSymbol ? tickers[asset.binanceSymbol] : undefined;
          const tradfi = tradfiQuotes[asset.symbol];
          const p = live?.price ?? tradfi?.price ?? 0;
          const ch = live?.change ?? tradfi?.change ?? 0;
          const active = selected === asset.symbol;
          const pos = ch >= 0;
          const isLast = i === watchlist.length - 1;

          return (
            <Link
              key={asset.symbol}
              href={assetHref(asset.symbol)}
              className="flex flex-col items-start px-5 py-3.5 shrink-0 cursor-pointer transition-all duration-200 text-left"
              style={{
                background: active ? "var(--surface-active)" : "transparent",
                borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                borderRight: !isLast ? "1px solid var(--border)" : "none",
                minWidth: "130px",
              }}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span style={{ fontSize: "11px" }}>{asset.icon}</span>
                <span className="text-xs font-semibold" style={{ color: active ? "var(--accent)" : "var(--text)" }}>
                  {asset.symbol.split("/")[0]}
                </span>
              </div>
              <span className="text-xs tabular-nums font-medium" style={{ color: "var(--text)" }}>
                {p > 0 ? formatPrice(p) : "—"}
              </span>
              <span className="text-[11px] mt-0.5 tabular-nums font-medium" style={{ color: pos ? "var(--green)" : "var(--red)" }}>
                {ch !== 0 ? `${pos ? "+" : ""}${ch.toFixed(2)}%` : "—"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
