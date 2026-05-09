"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_WATCHLIST, type Asset, ASSET_CATALOG, findAsset } from "@/lib/assetCatalog";

const LS_KEY = "alphaboard_watchlist_v2";
const MAX_ITEMS = 5;

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount (client only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        // Validate: only keep symbols that exist in the catalog
        const valid = parsed.filter((s) => ASSET_CATALOG.some((a) => a.symbol === s));
        if (valid.length > 0) setSymbols(valid.slice(0, MAX_ITEMS));
      }
    } catch {
      // ignore parse errors
    }
    setHydrated(true);
  }, []);

  const save = useCallback((next: string[]) => {
    setSymbols(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const addAsset = useCallback((symbol: string) => {
    setSymbols((prev) => {
      if (prev.includes(symbol)) return prev;
      if (prev.length >= MAX_ITEMS) return prev;
      const next = [...prev, symbol];
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const removeAsset = useCallback((symbol: string) => {
    setSymbols((prev) => {
      const next = prev.filter((s) => s !== symbol);
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setSymbols((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (symbol: string) => symbols.includes(symbol),
    [symbols]
  );

  const isFull = symbols.length >= MAX_ITEMS;

  /** Full Asset objects for the current watchlist, preserving order */
  const watchlist: Asset[] = symbols
    .map(findAsset)
    .filter((a): a is Asset => !!a);

  return {
    symbols,
    watchlist,
    hydrated,
    isFull,
    maxItems: MAX_ITEMS,
    addAsset,
    removeAsset,
    reorder,
    isSelected,
    save,
  };
}
