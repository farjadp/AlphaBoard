"use client";

import { useSyncExternalStore } from "react";
import type { ChartStudies } from "@/components/market/PriceChart";

export type ChartView = "plan" | "tradingview";
export interface ChartPrefs { view: ChartView; studies: ChartStudies }

const KEY = "alphaboard.chart.v1";
const DEFAULTS: ChartPrefs = { view: "plan", studies: { volume: true, ema20: false, ema50: false } };
const listeners = new Set<() => void>();
let cached: ChartPrefs | null = null;

function read(): ChartPrefs {
  if (cached) return cached;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<{ view: ChartView; studies: Partial<ChartStudies> }>;
    cached = { view: raw.view === "tradingview" ? "tradingview" : "plan", studies: { ...DEFAULTS.studies, ...raw.studies } };
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Chart view and studies, remembered per browser; defaults during SSR so hydration matches. */
export function useChartPrefs(): [ChartPrefs, (next: ChartPrefs) => void] {
  const prefs = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const set = (next: ChartPrefs) => {
    cached = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: keep in memory */ }
    listeners.forEach((l) => l());
  };
  return [prefs, set];
}
