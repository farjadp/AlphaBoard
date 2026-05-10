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
    if (binanceSymbols.length === 0) return;

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
        if (res.ok) {
          const data = await res.json();
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
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

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
        setConnected(false);
        retryRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { tickers, connected };
}
