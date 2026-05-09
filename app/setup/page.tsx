"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { ASSET_CATALOG, CATEGORY_LABELS, type Asset, type AssetCategory } from "@/lib/assetCatalog";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useTradfiQuotes } from "@/hooks/useTradfiQuotes";
import { useBinanceTickers } from "@/hooks/useBinanceTickers";
import { formatPrice } from "@/lib/binance";

const CATEGORIES: AssetCategory[] = ["crypto", "indices", "commodities", "forex"];

const CATEGORY_ICONS: Record<AssetCategory, string> = {
  crypto:      "₿",
  indices:     "📊",
  commodities: "🪙",
  forex:       "💱",
};

export default function SetupPage() {
  const router = useRouter();
  const { watchlist, symbols, addAsset, removeAsset, reorder, isSelected, isFull, maxItems } = useWatchlist();
  const [activeTab, setActiveTab] = useState<AssetCategory>("crypto");
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Live prices for setup page preview
  const cryptoSymbols = ASSET_CATALOG.filter((a) => a.binanceSymbol).map((a) => a.binanceSymbol!);
  const { tickers } = useBinanceTickers(cryptoSymbols);
  const tradfiSymbols = ASSET_CATALOG.filter((a) => a.yahooSymbol).map((a) => a.symbol);
  const tradfiQuotes = useTradfiQuotes(tradfiSymbols, 60_000);

  function getPrice(asset: Asset): number {
    if (asset.binanceSymbol) return tickers[asset.binanceSymbol]?.price ?? 0;
    return tradfiQuotes[asset.symbol]?.price ?? 0;
  }
  function getChange(asset: Asset): number {
    if (asset.binanceSymbol) return tickers[asset.binanceSymbol]?.change ?? 0;
    return tradfiQuotes[asset.symbol]?.change ?? 0;
  }

  // Filter catalog for current tab + search
  const filtered = ASSET_CATALOG.filter((a) => {
    const matchCat = a.category === activeTab;
    const q = search.toLowerCase();
    const matchSearch = !q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  function handleSave() {
    setSaved(true);
    setTimeout(() => { router.push("/"); }, 800);
  }

  // Drag to reorder watchlist
  function handleDragStart(i: number) { setDragFrom(i); }
  function handleDragEnter(i: number) { setDragOver(i); }
  function handleDragEnd() {
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
      reorder(dragFrom, dragOver);
    }
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <NavBar />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Catalog browser */}
        <div className="flex flex-col flex-1 min-w-0 border-r" style={{ borderColor: "var(--border)" }}>
          {/* Header */}
          <div className="px-6 pt-6 pb-4 shrink-0" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}>
            <h1 className="text-base font-bold mb-0.5" style={{ color: "var(--text)" }}>Asset Catalog</h1>
            <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>
              Select up to <strong style={{ color: "var(--accent)" }}>{maxItems}</strong> assets to track on your dashboard.
              {isFull && <span style={{ color: "var(--yellow)" }}> Watchlist is full — remove an asset to add new ones.</span>}
            </p>

            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-4"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input type="text" placeholder="Search by name or symbol…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full text-xs outline-none bg-transparent"
                style={{ color: "var(--text)" }} />
              {search && (
                <button onClick={() => setSearch("")} className="text-xs cursor-pointer" style={{ color: "var(--text-3)" }}>✕</button>
              )}
            </div>

            {/* Category tabs */}
            {!search && (
              <div className="flex gap-1">
                {CATEGORIES.map((cat) => {
                  const count = ASSET_CATALOG.filter((a) => a.category === cat).length;
                  const active = activeTab === cat;
                  return (
                    <button key={cat} onClick={() => setActiveTab(cat)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer"
                      style={{
                        background: active ? "var(--surface-active)" : "transparent",
                        color:      active ? "var(--accent)" : "var(--text-3)",
                        border:     active ? "1px solid var(--border-strong)" : "1px solid transparent",
                      }}>
                      <span>{CATEGORY_ICONS[cat]}</span>
                      {CATEGORY_LABELS[cat]}
                      <span className="text-[10px] px-1 rounded" style={{
                        background: active ? "var(--accent-dim)" : "var(--surface-2)",
                        color:      active ? "var(--accent)" : "var(--text-3)",
                      }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Asset grid */}
          <div className="flex-1 overflow-y-auto p-6">
            {search && (
              <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>
                {filtered.length} results for "{search}"
              </p>
            )}
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map((asset) => {
                const sel     = isSelected(asset.symbol);
                const price   = getPrice(asset);
                const change  = getChange(asset);
                const pos     = change >= 0;
                const canAdd  = !sel && !isFull;

                return (
                  <div key={asset.symbol}
                    className="glass-card p-4 transition-all duration-200 animate-fade-up"
                    style={{ opacity: isFull && !sel ? 0.5 : 1 }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{asset.icon}</span>
                        <div>
                          <div className="text-xs font-bold" style={{ color: "var(--text)" }}>{asset.symbol.split("/")[0]}</div>
                          <div className="text-[10px]" style={{ color: "var(--text-3)" }}>{asset.name}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => sel ? removeAsset(asset.symbol) : canAdd ? addAsset(asset.symbol) : null}
                        disabled={!sel && isFull}
                        className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-all duration-150 cursor-pointer shrink-0 ml-2"
                        style={{
                          background: sel        ? "var(--red-bg)"    : canAdd ? "var(--green-bg)"  : "var(--surface-2)",
                          color:      sel        ? "var(--red)"       : canAdd ? "var(--green)"     : "var(--text-3)",
                          border:     `1px solid ${sel ? "var(--red)" : canAdd ? "var(--green)" : "var(--border)"}`,
                          cursor:     isFull && !sel ? "not-allowed" : "pointer",
                        }}
                      >
                        {sel ? "− Remove" : "+ Add"}
                      </button>
                    </div>

                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-sm tabular-nums font-bold" style={{ color: "var(--text)" }}>
                          {price > 0 ? formatPrice(price) : "—"}
                        </div>
                        <div className="text-[11px] tabular-nums font-medium mt-0.5"
                          style={{ color: change !== 0 ? (pos ? "var(--green)" : "var(--red)") : "var(--text-3)" }}>
                          {change !== 0 ? `${pos ? "+" : ""}${change.toFixed(2)}%` : "loading…"}
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium capitalize"
                        style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                        {asset.category}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Watchlist panel */}
        <div className="w-72 shrink-0 flex flex-col" style={{ background: "var(--bg-2)" }}>
          <div className="px-5 py-5 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>My Watchlist</h2>
              <span className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-md"
                style={{ background: symbols.length === maxItems ? "var(--yellow-bg)" : "var(--accent-dim)",
                         color: symbols.length === maxItems ? "var(--yellow)" : "var(--accent)" }}>
                {symbols.length}/{maxItems}
              </span>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Drag to reorder. Changes save automatically.</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {watchlist.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                <span style={{ fontSize: "32px" }}>📋</span>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>
                  No assets selected yet.<br />Pick up to {maxItems} from the catalog.
                </p>
              </div>
            ) : (
              watchlist.map((asset, i) => {
                const price  = getPrice(asset);
                const change = getChange(asset);
                const pos    = change >= 0;

                return (
                  <div key={asset.symbol}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragEnter={() => handleDragEnter(i)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-grab transition-all duration-150"
                    style={{
                      background:  dragOver === i ? "var(--surface-active)" : "var(--surface)",
                      border:      `1px solid ${dragOver === i ? "var(--accent)" : "var(--border)"}`,
                      opacity:     dragFrom === i ? 0.4 : 1,
                    }}
                  >
                    <span style={{ fontSize: "16px" }}>{asset.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>{asset.symbol.split("/")[0]}</div>
                      <div className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>{asset.name}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs tabular-nums font-medium" style={{ color: "var(--text)" }}>
                        {price > 0 ? formatPrice(price) : "—"}
                      </div>
                      <div className="text-[10px] tabular-nums font-medium"
                        style={{ color: change !== 0 ? (pos ? "var(--green)" : "var(--red)") : "var(--text-3)" }}>
                        {change !== 0 ? `${pos ? "+" : ""}${change.toFixed(2)}%` : "—"}
                      </div>
                    </div>
                    <button onClick={() => removeAsset(asset.symbol)}
                      className="w-6 h-6 rounded-md flex items-center justify-center transition-all duration-150 cursor-pointer shrink-0"
                      style={{ color: "var(--text-3)", background: "transparent" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red-bg)"; e.currentTarget.style.color = "var(--red)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-3)"; }}
                    >✕</button>
                  </div>
                );
              })
            )}
          </div>

          {/* Save bar */}
          <div className="p-4 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={handleSave}
              className="glow-btn w-full py-3 text-xs font-semibold tracking-wide"
              style={saved ? { background: "var(--green-bg)", boxShadow: "none", color: "var(--green)" } : {}}>
              {saved ? "✓ Saved — Redirecting…" : "Save & Go to Dashboard"}
            </button>
            <p className="text-[10px] text-center mt-2" style={{ color: "var(--text-3)" }}>
              Changes are saved automatically
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
