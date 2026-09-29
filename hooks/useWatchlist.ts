"use client";

import { useCallback } from "react";
import { DEFAULT_WATCHLIST, findAsset, type Asset } from "@/lib/assetCatalog";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";

const MAX_ITEMS = 5;

const watchlistResource = createResource<string[]>("/api/watchlist", {
  fallback: DEFAULT_WATCHLIST,
  select: (j) => (j as { symbols: string[] }).symbols,
});

function save(next: string[]) {
  const symbols = next.slice(0, MAX_ITEMS);
  return watchlistResource
    .mutate<{ symbols: string[] }>({
      optimistic: () => symbols,
      request: jsonRequest("/api/watchlist", "PUT", { symbols }),
      apply: (_d, body) => body.symbols,
    })
    .catch(() => undefined); // error is exposed via the resource state
}

export function useWatchlist() {
  const { data: symbols, loaded, error } = useResource(watchlistResource);

  const addAsset = useCallback((symbol: string) => {
    const prev = watchlistResource.peek();
    if (prev.includes(symbol) || prev.length >= MAX_ITEMS) return;
    void save([...prev, symbol]);
  }, []);

  const removeAsset = useCallback((symbol: string) => {
    void save(watchlistResource.peek().filter((s) => s !== symbol));
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    const next = [...watchlistResource.peek()];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    void save(next);
  }, []);

  const isSelected = useCallback((symbol: string) => symbols.includes(symbol), [symbols]);
  const watchlist: Asset[] = symbols.map(findAsset).filter((a): a is Asset => !!a);

  return {
    symbols,
    watchlist,
    hydrated: loaded,
    error,
    isFull: symbols.length >= MAX_ITEMS,
    maxItems: MAX_ITEMS,
    addAsset,
    removeAsset,
    reorder,
    isSelected,
    save: useCallback((next: string[]) => { void save(next); }, []),
  };
}
