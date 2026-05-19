"use client";

import { useState, useEffect } from "react";

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

const STORAGE_KEY = "alphaboard_chart_academy";
const MAX_LESSONS = 20; // keep last 20 lessons to avoid bloating localStorage

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useChartAcademy() {
  const [lessons, setLessons] = useState<ChartLesson[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setLessons(JSON.parse(stored));
      }
    } catch (e) {
      console.error("useChartAcademy: failed to load lessons", e);
    }
    setHydrated(true);
  }, []);

  const persist = (updated: ChartLesson[]) => {
    setLessons(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error("useChartAcademy: failed to save lessons", e);
    }
  };

  const addLesson = (lesson: Omit<ChartLesson, "id" | "createdAt">) => {
    const newLesson: ChartLesson = {
      ...lesson,
      id: Date.now().toString() + Math.random().toString(36).substring(2, 8),
      createdAt: new Date().toISOString(),
    };
    // Prepend and cap at MAX_LESSONS
    const updated = [newLesson, ...lessons].slice(0, MAX_LESSONS);
    persist(updated);
    return newLesson.id;
  };

  const removeLesson = (id: string) => {
    persist(lessons.filter((l) => l.id !== id));
  };

  const clearLessons = () => {
    persist([]);
  };

  /** Returns the last N lessons formatted for the analyze API prompt */
  const getLessonsForPrompt = (n = 5): Array<{
    symbol?: string;
    signal: string;
    lesson: string;
    patterns: string[];
    tags: string[];
    confluenceScore: number;
    createdAt: string;
  }> => {
    return lessons.slice(0, n).map((l) => ({
      symbol: l.symbol,
      signal: l.overallSignal,
      lesson: l.lesson,
      patterns: l.patterns,
      tags: l.tags,
      confluenceScore: l.confluenceScore,
      createdAt: l.createdAt,
    }));
  };

  return {
    lessons,
    hydrated,
    addLesson,
    removeLesson,
    clearLessons,
    getLessonsForPrompt,
  };
}
