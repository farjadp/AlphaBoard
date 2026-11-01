"use client";

import { useEffect, useState } from "react";
import { binanceKlineStream, parseKlineMessage, type LiveBar } from "@/lib/market/tradingview";
import type { TimeframeKey } from "@/lib/market/timeframes";

const STREAM_HOST = "wss://data-stream.binance.vision/ws";

export interface LiveBarState {
  bar: LiveBar | null;
  connected: boolean;
}

/**
 * The forming candle of a Binance pair, pushed on every trade by the public kline stream.
 * Off for non-Binance symbols (`binanceSymbol` undefined). Reconnects with a capped backoff.
 */
export function useLiveBar(binanceSymbol: string | undefined, timeframe: TimeframeKey): LiveBarState {
  const key = binanceSymbol ? binanceKlineStream(binanceSymbol, timeframe) : null;
  const [state, setState] = useState<LiveBarState & { key: string | null }>({ key, bar: null, connected: false });

  useEffect(() => {
    if (!key) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const open = () => {
      socket = new WebSocket(`${STREAM_HOST}/${key}`);
      socket.onopen = () => { attempt = 0; setState((s) => ({ ...s, key, connected: true })); };
      socket.onmessage = (ev) => {
        try {
          const bar = parseKlineMessage(JSON.parse(String(ev.data)));
          if (bar) setState({ key, bar, connected: true });
        } catch {
          // A malformed frame is skipped; the next trade sends a full bar again.
        }
      };
      socket.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (closed) return;
        retry = setTimeout(open, Math.min(30_000, 1_000 * 2 ** attempt++));
      };
      socket.onerror = () => socket?.close();
    };
    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [key]);

  if (!key || state.key !== key) return { bar: null, connected: false };
  return state;
}
