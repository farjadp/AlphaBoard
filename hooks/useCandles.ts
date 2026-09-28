"use client";

import { useEffect, useState } from "react";

export interface ChartCandle {
  /** Bar open time, UNIX seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandlesState {
  candles: ChartCandle[];
  status: "loading" | "ready" | "error";
  error?: string;
}

/** OHLC bars from /api/candles, refreshed every `refreshMs`. Previous bars stay visible while reloading. */
export function useCandles(symbol: string, timeframe: string, refreshMs = 60_000): CandlesState {
  const key = `${symbol}|${timeframe}`;
  const [state, setState] = useState<CandlesState & { key: string }>({ key, candles: [], status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState((s) => ({ key, candles: s.key === key ? s.candles : [], status: "error", error: body.error ?? "Price history is unavailable right now" }));
          return;
        }
        setState({ key, candles: body.candles ?? [], status: "ready" });
      } catch {
        if (!cancelled) setState((s) => ({ key, candles: s.key === key ? s.candles : [], status: "error", error: "Price history is unavailable right now" }));
      }
    }
    void load();
    const id = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [key, symbol, timeframe, refreshMs]);

  // A symbol/timeframe switch shows "loading" until its own first response arrives.
  if (state.key !== key) return { candles: [], status: "loading" };
  return state;
}
