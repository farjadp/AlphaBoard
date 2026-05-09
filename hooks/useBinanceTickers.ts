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
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

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
