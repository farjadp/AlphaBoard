"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { ASSET_CATALOG, CATEGORY_LABELS, type Asset, type AssetCategory } from "@/lib/assetCatalog";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useTradfiQuotes } from "@/hooks/useTradfiQuotes";
import { useBinanceTickers } from "@/hooks/useBinanceTickers";
import { formatPrice } from "@/lib/binance";

const CATEGORIES: AssetCategory[] = ["crypto", "indices", "commodities", "forex"];

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
    <div className="flex h-full flex-col overflow-hidden bg-page">
      <NavBar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: Catalog browser */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-line">
          {/* Header */}
          <div className="shrink-0 border-b border-line bg-paper px-6 pb-4 pt-6">
            <h1 className="mb-0.5 font-display text-2xl font-extrabold text-ink">Asset Catalog</h1>
            <p className="mb-4 text-xs text-ink-3">
              Select up to <strong className="text-ink">{maxItems}</strong> assets to track on your dashboard.
              {isFull && <span className="text-amber"> Watchlist is full — remove an asset to add new ones.</span>}
            </p>

            {/* Search */}
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2.5 focus-within:border-accent">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-ink-3">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input type="text" placeholder="Search by name or symbol…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-3" />
              {search && (
                <button onClick={() => setSearch("")} className="cursor-pointer text-xs text-ink-3 hover:text-ink">✕</button>
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
                      className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors duration-150 ${
                        active ? "border-line-2 bg-accent-soft text-accent" : "border-transparent text-ink-3 hover:bg-wash hover:text-ink"
                      }`}>
                      {CATEGORY_LABELS[cat]}
                      <span className={`num rounded px-1 text-[10px] ${active ? "bg-paper text-accent" : "bg-wash text-ink-3"}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Asset grid */}
          <div className="flex-1 overflow-y-auto p-6">
            {search && (
              <p className="mb-4 text-xs text-ink-3">
                {filtered.length} results for &quot;{search}&quot;
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {filtered.map((asset) => {
                const sel     = isSelected(asset.symbol);
                const price   = getPrice(asset);
                const change  = getChange(asset);
                const pos     = change >= 0;
                const canAdd  = !sel && !isFull;

                const toggleClass = sel
                  ? "cursor-pointer border-down bg-down-soft text-down"
                  : canAdd
                    ? "cursor-pointer border-up bg-up-soft text-up"
                    : "cursor-not-allowed border-line bg-wash text-ink-3";
                const changeClass = change !== 0 ? (pos ? "text-up" : "text-down") : "text-ink-3";

                return (
                  <div key={asset.symbol}
                    className={`panel p-4 transition-opacity duration-200 animate-fade-up ${isFull && !sel ? "opacity-50" : ""}`}
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{asset.icon}</span>
                        <div>
                          <div className="text-xs font-bold text-ink">{asset.symbol.split("/")[0]}</div>
                          <div className="text-[10px] text-ink-3">{asset.name}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => sel ? removeAsset(asset.symbol) : canAdd ? addAsset(asset.symbol) : null}
                        disabled={!sel && isFull}
                        className={`ml-2 shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors duration-150 ${toggleClass}`}
                      >
                        {sel ? "− Remove" : "+ Add"}
                      </button>
                    </div>

                    <div className="flex items-end justify-between">
                      <div>
                        <div className="num text-sm font-bold text-ink">
                          {price > 0 ? formatPrice(price) : "—"}
                        </div>
                        <div className={`num mt-0.5 text-[11px] font-medium ${changeClass}`}>
                          {change !== 0 ? `${pos ? "+" : ""}${change.toFixed(2)}%` : "loading…"}
                        </div>
                      </div>
                      <span className="rounded-md bg-wash px-1.5 py-0.5 text-[10px] font-medium capitalize text-ink-3">
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
        <div className="flex w-72 shrink-0 flex-col bg-paper">
          <div className="shrink-0 border-b border-line px-5 py-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">My Watchlist</h2>
              <span className={`num rounded-md px-2 py-0.5 text-xs font-semibold ${
                symbols.length === maxItems ? "bg-amber-soft text-amber" : "bg-accent-soft text-accent"
              }`}>
                {symbols.length}/{maxItems}
              </span>
            </div>
            <p className="text-[11px] text-ink-3">Drag to reorder. Changes save automatically.</p>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {watchlist.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
                <p className="text-xs text-ink-3">
                  No assets selected yet.<br />Pick up to {maxItems} from the catalog.
                </p>
              </div>
            ) : (
              watchlist.map((asset, i) => {
                const price  = getPrice(asset);
                const change = getChange(asset);
                const pos    = change >= 0;
                const changeClass = change !== 0 ? (pos ? "text-up" : "text-down") : "text-ink-3";

                return (
                  <div key={asset.symbol}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragEnter={() => handleDragEnter(i)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    className={`flex cursor-grab items-center gap-3 rounded-lg border px-3 py-3 transition-colors duration-150 ${
                      dragOver === i ? "border-accent bg-accent-soft" : "border-line bg-paper"
                    } ${dragFrom === i ? "opacity-40" : ""}`}
                  >
                    <span className="text-base">{asset.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-ink">{asset.symbol.split("/")[0]}</div>
                      <div className="truncate text-[10px] text-ink-3">{asset.name}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-xs font-medium text-ink">
                        {price > 0 ? formatPrice(price) : "—"}
                      </div>
                      <div className={`num text-[10px] font-medium ${changeClass}`}>
                        {change !== 0 ? `${pos ? "+" : ""}${change.toFixed(2)}%` : "—"}
                      </div>
                    </div>
                    <button onClick={() => removeAsset(asset.symbol)}
                      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-down-soft hover:text-down"
                    >✕</button>
                  </div>
                );
              })
            )}
          </div>

          {/* Save bar */}
          <div className="shrink-0 border-t border-line p-4">
            <button onClick={handleSave}
              className={`w-full cursor-pointer rounded-lg py-3 text-xs font-bold tracking-wide ${
                saved ? "bg-up-soft text-up" : "bg-ink text-paper hover:bg-[#23313f]"
              }`}>
              {saved ? "✓ Saved — Redirecting…" : "Save & Go to Dashboard"}
            </button>
            <p className="mt-2 text-center text-[10px] text-ink-3">
              Changes are saved automatically
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
