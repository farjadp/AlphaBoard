"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import type { ChartCandle } from "@/lib/client/hooks/useCandles";
import type { LiveBar } from "@/lib/market/tradingview";
import { ema } from "@/lib/market/chartStudies";
import { useColorScheme } from "@/lib/client/hooks/useColorScheme";

export interface ChartLevel {
  price: number;
  kind: "entry" | "tp" | "sl" | "support" | "resistance";
  label: string;
}

export interface ChartStudies {
  volume: boolean;
  ema20: boolean;
  ema50: boolean;
}

interface PriceChartProps {
  candles: ChartCandle[];
  levels: ChartLevel[];
  /** Decimal places for the price scale. */
  precision: number;
  /** The forming bar from the live stream; replaces or extends the last candle. */
  live?: LiveBar | null;
  studies: ChartStudies;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Same hue as `color` at `alpha`, for volume bars that must sit behind the candles. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
  const n = parseInt(hex, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const t = (s: number) => s as UTCTimestamp;

/** Candlestick chart with volume, EMAs and the strategy's levels drawn on the price scale. */
export default function PriceChart({ candles, levels, precision, live, studies }: PriceChartProps) {
  const scheme = useColorScheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const colorsRef = useRef({ up: "", down: "" });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ink3 = token("--color-ink-3");
    const line = token("--color-line");
    const up = token("--color-up");
    const down = token("--color-down");
    colorsRef.current = { up, down };
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
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.08, bottom: 0.22 } },
      // A fixed bar spacing keeps recent bars readable regardless of when the container gets its size.
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, minBarSpacing: 2 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    volumeRef.current = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    ema20Ref.current = chart.addSeries(LineSeries, { color: token("--color-accent"), lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    ema50Ref.current = chart.addSeries(LineSeries, { color: token("--color-amber"), lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: up, borderUpColor: up, wickUpColor: up,
      downColor: down, borderDownColor: down, wickDownColor: down,
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = volumeRef.current = ema20Ref.current = ema50Ref.current = null;
      linesRef.current = [];
    };
  }, [scheme]);

  // Effects run in order, so after a theme rebuild the data effects below repaint the new chart (`scheme` dep).
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const { up, down } = colorsRef.current;
    series.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
    series.setData(candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    const hasVolume = candles.some((c) => c.volume !== undefined);
    volumeRef.current?.setData(studies.volume && hasVolume
      ? candles.map((c) => ({ time: t(c.time), value: c.volume ?? 0, color: withAlpha(c.close >= c.open ? up : down, 0.35) }))
      : []);
    const closes = candles.map((c) => c.close);
    const toLine = (values: (number | null)[]) => values.flatMap((v, i) => (v === null ? [] : [{ time: t(candles[i].time), value: v }]));
    ema20Ref.current?.setData(studies.ema20 ? toLine(ema(closes, 20)) : []);
    ema50Ref.current?.setData(studies.ema50 ? toLine(ema(closes, 50)) : []);
  }, [candles, precision, studies, scheme]);

  useEffect(() => {
    const series = candleRef.current;
    const last = candles.at(-1);
    if (!series || !live || !last || live.time < last.time) return;
    const { up, down } = colorsRef.current;
    series.update({ time: t(live.time), open: live.open, high: live.high, low: live.low, close: live.close });
    if (studies.volume) volumeRef.current?.update({ time: t(live.time), value: live.volume, color: withAlpha(live.close >= live.open ? up : down, 0.35) });
  }, [live, candles, studies.volume, scheme]);

  useEffect(() => {
    const series = candleRef.current;
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
  }, [levels, scheme]);

  return <div ref={hostRef} className="h-full w-full" />;
}
