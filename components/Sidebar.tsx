"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/binance";
import type { BinanceTicker } from "@/lib/binance";
import { assetHref, type Asset } from "@/lib/assetCatalog";
import type { TradfiQuoteMap } from "@/hooks/useTradfiQuotes";

interface SidebarProps {
  selected: string;
  tickers: Record<string, BinanceTicker>;
  tradfiQuotes: TradfiQuoteMap;
  watchlist: Asset[];
}

export default function Sidebar({ selected, tickers, tradfiQuotes, watchlist }: SidebarProps) {
  return (
    <aside
      className="flex flex-col w-56 shrink-0 h-full"
      style={{ background: "var(--bg-2)", borderRight: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--text-2)" }}>Watchlist</span>
        <Link href="/setup" className="text-[10px] px-2 py-1 rounded-md transition-all duration-150 cursor-pointer"
          style={{ background: "var(--accent-dim)", color: "var(--accent)", fontWeight: 600 }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-dim)"; }}
        >
          + Edit
        </Link>
      </div>

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto py-1">
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <span style={{ fontSize: "28px" }}>📋</span>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>No assets in watchlist</p>
            <Link href="/setup"
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
            >
              Go to Setup
            </Link>
          </div>
        ) : (
          watchlist.map((asset, i) => {
            const live   = asset.binanceSymbol ? tickers[asset.binanceSymbol] : undefined;
            const tradfi = tradfiQuotes[asset.symbol];
            const price  = live?.price  ?? tradfi?.price  ?? 0;
            const change = live?.change ?? tradfi?.change ?? 0;
            const positive  = change >= 0;
            const isSelected = selected === asset.symbol;

            return (
              <Link
                key={asset.symbol}
                className="w-full flex items-center justify-between px-4 py-3 text-left transition-all duration-150 cursor-pointer animate-fade-up"
                style={{
                  background:  isSelected ? "var(--surface-active)" : "transparent",
                  borderLeft:  `3px solid ${isSelected ? "var(--accent)" : "transparent"}`,
                  animationDelay: `${i * 30}ms`,
                }}
                href={assetHref(asset.symbol)}
              >
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: "14px" }}>{asset.icon}</span>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>{asset.symbol}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>{asset.name}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs tabular-nums font-medium" style={{ color: "var(--text)" }}>
                    {price > 0 ? formatPrice(price) : "—"}
                  </div>
                  <div className="text-[11px] tabular-nums mt-0.5 font-medium"
                    style={{ color: change !== 0 ? (positive ? "var(--green)" : "var(--red)") : "var(--text-3)" }}>
                    {change !== 0 ? `${positive ? "+" : ""}${change.toFixed(2)}%` : "—"}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 text-[11px] flex items-center justify-between"
        style={{ borderTop: "1px solid var(--border)", color: "var(--text-3)" }}>
        <span>{watchlist.length}/5 assets</span>
        <Link href="/setup" style={{ color: "var(--accent)", fontSize: "10px", fontWeight: 500 }}>
          SETUP →
        </Link>
      </div>
    </aside>
  );
}
