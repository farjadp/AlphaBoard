"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import type { ChartCandle } from "@/hooks/useCandles";

export interface ChartLevel {
  price: number;
  kind: "entry" | "tp" | "sl" | "support" | "resistance";
  label: string;
}

interface PriceChartProps {
  candles: ChartCandle[];
  levels: ChartLevel[];
  /** Decimal places for the price scale. */
  precision: number;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Candlestick chart with the strategy's levels drawn on the price scale. */
export default function PriceChart({ candles, levels, precision }: PriceChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ink3 = token("--color-ink-3");
    const line = token("--color-line");
    const up = token("--color-up");
    const down = token("--color-down");
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: token("--color-paper") },
        textColor: ink3,
        fontFamily: `${token("--font-jetbrains") || "ui-monospace"}, monospace`,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line },
      // A fixed bar spacing keeps recent bars readable regardless of when the container gets its size.
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7, minBarSpacing: 2 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: token("--color-paper"),
      borderUpColor: up,
      wickUpColor: up,
      downColor: down,
      borderDownColor: down,
      wickDownColor: down,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
    series.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
  }, [candles, precision]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const l of linesRef.current) series.removePriceLine(l);
    const color: Record<ChartLevel["kind"], string> = {
      entry: token("--color-accent"),
      tp: token("--color-up"),
      sl: token("--color-down"),
      support: token("--color-ink-3"),
      resistance: token("--color-ink-3"),
    };
    linesRef.current = levels.map((l) => series.createPriceLine({
      price: l.price,
      color: color[l.kind],
      lineWidth: l.kind === "support" || l.kind === "resistance" ? 1 : 2,
      lineStyle: l.kind === "entry" ? LineStyle.Solid : l.kind === "support" || l.kind === "resistance" ? LineStyle.Dotted : LineStyle.Dashed,
      axisLabelVisible: true,
      title: l.label,
    }));
  }, [levels]);

  return <div ref={hostRef} className="h-full w-full" />;
}
