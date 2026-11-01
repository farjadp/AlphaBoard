"use client";

import { useEffect, useRef } from "react";
import { useColorScheme } from "@/lib/client/hooks/useColorScheme";

function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const WIDGET_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

interface TradingViewChartProps {
  /** TradingView symbol, e.g. "BINANCE:BTCUSDT" (see lib/market/tradingview). */
  symbol: string;
  /** Widget interval: "5" | "15" | "60" | "240" | "D" | "W" | "M". */
  interval: string;
}

/**
 * TradingView's free Advanced Real-Time Chart widget: their data, drawing tools and indicators in an iframe.
 * Our plan levels cannot be drawn into it; that is what the AlphaBoard chart beside it is for.
 * The attribution link under the chart is a condition of the free widget, keep it visible.
 */
export default function TradingViewChart({ symbol, interval }: TradingViewChartProps) {
  const scheme = useColorScheme();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const slot = document.createElement("div");
    slot.className = "tradingview-widget-container__widget h-full w-full";
    host.appendChild(slot);
    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.type = "text/javascript";
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
      theme: scheme,
      // Match the sheet the widget sits on instead of TradingView's own black / white ground.
      backgroundColor: cssToken("--color-paper"),
      gridColor: cssToken("--color-line"),
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      hide_side_toolbar: false,
      withdateranges: true,
      details: false,
      calendar: false,
      save_image: true,
      support_host: "https://www.tradingview.com",
    });
    host.appendChild(script);
    return () => host.replaceChildren();
  }, [symbol, interval, scheme]);

  return (
    <div className="flex h-full flex-col">
      <div ref={hostRef} className="tradingview-widget-container min-h-0 flex-1" />
      <a
        href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`}
        target="_blank"
        rel="noopener nofollow"
        className="mt-1 self-end text-[11px] text-ink-3 hover:text-ink"
      >
        {symbol} chart by TradingView
      </a>
    </div>
  );
}
