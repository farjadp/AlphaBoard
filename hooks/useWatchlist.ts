"use client";

import { useCallback } from "react";
import { DEFAULT_WATCHLIST, ASSET_CATALOG, findAsset, type Asset } from "@/lib/assetCatalog";
import { createLocalStore, useHydrated, useLocalStore } from "@/lib/client/localStore";

const MAX_ITEMS = 5;

const watchlistStore = createLocalStore<string[]>("alphaboard_watchlist_v2", DEFAULT_WATCHLIST, {
  parse: (raw) => {
    if (!Array.isArray(raw)) throw new Error("watchlist: not an array");
    const valid = Array.from(new Set(raw.filter((s): s is string => typeof s === "string" && ASSET_CATALOG.some((a) => a.symbol === s))));
    return valid.length ? valid.slice(0, MAX_ITEMS) : DEFAULT_WATCHLIST;
  },
});

export function useWatchlist() {
  const symbols = useLocalStore(watchlistStore);
  const hydrated = useHydrated();

  const addAsset = useCallback((symbol: string) => {
    watchlistStore.update((prev) => (prev.includes(symbol) || prev.length >= MAX_ITEMS ? prev : [...prev, symbol]));
  }, []);

  const removeAsset = useCallback((symbol: string) => {
    watchlistStore.update((prev) => prev.filter((s) => s !== symbol));
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    watchlistStore.update((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const save = useCallback((next: string[]) => { watchlistStore.update(() => next.slice(0, MAX_ITEMS)); }, []);
  const isSelected = useCallback((symbol: string) => symbols.includes(symbol), [symbols]);

  /** Full Asset objects for the current watchlist, preserving order */
  const watchlist: Asset[] = symbols.map(findAsset).filter((a): a is Asset => !!a);

  return {
    symbols,
    watchlist,
    hydrated,
    isFull: symbols.length >= MAX_ITEMS,
    maxItems: MAX_ITEMS,
    addAsset,
    removeAsset,
    reorder,
    isSelected,
    save,
  };
}
