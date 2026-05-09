"use client";

import { useEffect, useRef, useState } from "react";
import { ASSET_CATALOG } from "@/lib/assetCatalog";

export interface TradfiQuote {
  price: number;
  change: number;
  high: number;
  low: number;
  volume: number;
}

export type TradfiQuoteMap = Record<string, TradfiQuote>;

/**
 * Polls /api/quotes for the given non-crypto symbols.
 * Automatically re-fetches when the symbol list changes.
 */
export function useTradfiQuotes(symbols: string[], intervalMs = 60_000) {
  const [quotes, setQuotes] = useState<TradfiQuoteMap>({});
  const mountedRef = useRef(true);

  // Only fetch symbols that have a Yahoo Finance mapping
  const tradfiSymbols = symbols.filter((s) =>
    ASSET_CATALOG.find((a) => a.symbol === s && a.yahooSymbol)
  );
  const key = tradfiSymbols.join(",");

  useEffect(() => {
    mountedRef.current = true;
    if (tradfiSymbols.length === 0) return;

    async function fetchQuotes() {
      try {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (mountedRef.current) setQuotes(data);
      } catch {}
    }

    fetchQuotes();
    const id = setInterval(fetchQuotes, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  return quotes;
}
