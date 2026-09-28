"use client";

import { useCallback } from "react";
import { createLocalStore, useHydrated, useLocalStore, STORAGE_FULL_MESSAGE } from "@/lib/client/localStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnnotationType =
  | "hline" | "line" | "zone" | "arrow_up" | "arrow_down"
  | "marker" | "channel" | "fib" | "label";

export type AnnotationCategory =
  | "support" | "resistance" | "ob_bull" | "ob_bear"
  | "fvg_bull" | "fvg_bear" | "entry" | "sl" | "tp"
  | "trendline" | "bos" | "choch" | "pattern"
  | "candlestick" | "ema" | "liquidity" | "other";

export interface Annotation {
  type: AnnotationType;
  category?: AnnotationCategory;
  color: string;
  label?: string;
  priority?: "high" | "medium" | "low";
  note?: string;
  // hline: y only
  y?: number;
  // line / trendline
  x1?: number; y1?: number;
  x2?: number; y2?: number;
  // zone / rectangle (z-prefix to avoid collision)
  zx?: number; zy?: number; zw?: number; zh?: number;
  // marker / arrow_up / arrow_down / label: single point
  mx?: number; my?: number;
  // channel: two parallel lines
  cy1a?: number; cy1b?: number; cy2a?: number; cy2b?: number;
  // style
  dashed?: boolean;
  thickness?: number;
  fillOpacity?: number;
}

export type Timeframe = "15m" | "1H" | "4H" | "1D";

export interface TimeframeChart {
  timeframe: Timeframe;
  imageDataUrl: string; // base64
  annotations: Annotation[];
  signal?: "BUY" | "SELL" | "HOLD";
  bias?: string;
}

export interface ChartLesson {
  id: string;
  createdAt: string; // ISO
  symbol?: string;
  overallSignal: "BUY" | "SELL" | "HOLD";
  confluenceScore: number; // 0–100
  summary: string; // AI short summary
  lesson: string; // the educational takeaway
  patterns: string[];
  tags: string[];
  charts: TimeframeChart[]; // up to 3 timeframes
  // For feeding back into analyze API
  rootCause?: string;
  mistakes?: string[];
  strengths?: string[];
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const MAX_LESSONS = 20; // chart images are large; P2 moves them to server storage
const EMPTY: ChartLesson[] = [];

const academyStore = createLocalStore<ChartLesson[]>("alphaboard_chart_academy", EMPTY, {
  parse: (raw) => (Array.isArray(raw) ? (raw as ChartLesson[]).filter((l) => l && typeof l.id === "string") : EMPTY),
});

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useChartAcademy() {
  const lessons = useLocalStore(academyStore);
  const hydrated = useHydrated();

  /** Returns the new lesson id, or throws with a user-facing message if it could not be saved. */
  const addLesson = useCallback((lesson: Omit<ChartLesson, "id" | "createdAt">) => {
    const entry: ChartLesson = { ...lesson, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    const res = academyStore.update((prev) => [entry, ...prev].slice(0, MAX_LESSONS));
    if (!res.ok) throw new Error(res.quotaExceeded ? STORAGE_FULL_MESSAGE : "The lesson could not be saved in this browser.");
    return entry.id;
  }, []);

  const removeLesson = useCallback((id: string) => { academyStore.update((prev) => prev.filter((l) => l.id !== id)); }, []);
  const clearLessons = useCallback(() => { academyStore.update(() => []); }, []);

  /** Compact text-only summaries for the strategy prompt (never the chart images). */
  const getLessonsForPrompt = useCallback((n = 5) =>
    academyStore.read().slice(0, n).map((l) => ({
      symbol: l.symbol,
      signal: l.overallSignal,
      lesson: l.lesson,
      patterns: l.patterns,
      tags: l.tags,
      confluenceScore: l.confluenceScore,
      createdAt: l.createdAt,
    })), []);

  return { lessons, hydrated, addLesson, removeLesson, clearLessons, getLessonsForPrompt };
}
