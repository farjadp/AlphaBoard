"use client";

import { useEffect, useRef, useState } from "react";
import type { BinanceTicker } from "@/lib/binance";

export type TickerMap = Record<string, BinanceTicker>;

export function useBinanceTickers(binanceSymbols: string[]) {
  const [tickers, setTickers] = useState<TickerMap>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = binanceSymbols.join(",");

  useEffect(() => {
    const binanceSymbols = key ? key.split(",") : [];
    if (binanceSymbols.length === 0) return;
    // v1 bug: cleanup cleared the timer *before* close(); onclose then scheduled a fresh
    // reconnect for the old symbol set, leaking one socket per watchlist change.
    let disposed = false;
    let attempt = 0;

    const streams = binanceSymbols
      .map((s) => s.toLowerCase() + "@ticker")
      .join("/");
    // Use data-stream.binance.vision to bypass regional IP blocks (e.g., US/Canada)
    const url = `wss://data-stream.binance.vision/stream?streams=${streams}`;

    // 1. Fetch initial state immediately via REST (unblocked endpoint)
    async function fetchInitial() {
      try {
        const symbolsParam = JSON.stringify(binanceSymbols.map(s => s.toUpperCase()));
        const restUrl = `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${symbolsParam}`;
        const res = await fetch(restUrl);
        if (res.ok && !disposed) {
          const data = await res.json();
          if (disposed) return;
          setTickers((prev) => {
            const next = { ...prev };
            for (const item of data) {
              next[item.symbol] = {
                symbol: item.symbol,
                price: parseFloat(item.lastPrice),
                change: parseFloat(item.priceChangePercent),
                high: parseFloat(item.highPrice),
                low: parseFloat(item.lowPrice),
                volume: parseFloat(item.quoteVolume),
              };
            }
            return next;
          });
        }
      } catch {
        // Silently fail and rely on WebSockets
      }
    }
    fetchInitial();

    // 2. Connect WebSocket for live updates

    function connect() {
      if (disposed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => { attempt = 0; setConnected(true); };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as {
            data: {
              s: string; // symbol
              c: string; // last price
              P: string; // price change percent
              h: string; // 24h high
              l: string; // 24h low
              q: string; // quote asset volume (USDT)
            };
          };
          const d = msg.data;
          if (!d?.s) return;
          setTickers((prev) => ({
            ...prev,
            [d.s]: {
              symbol: d.s,
              price: parseFloat(d.c),
              change: parseFloat(d.P),
              high: parseFloat(d.h),
              low: parseFloat(d.l),
              volume: parseFloat(d.q),
            },
          }));
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        const delay = Math.min(30_000, 1_000 * 2 ** attempt++); // 1s, 2s, 4s … capped at 30s
        retryRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      disposed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      const ws = wsRef.current;
      if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); }
      wsRef.current = null;
      setConnected(false);
    };
  }, [key]);

  return { tickers, connected };
}
