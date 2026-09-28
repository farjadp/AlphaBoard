"use client";

import { useCallback } from "react";
import { createLocalStore, useLocalStore } from "@/lib/client/localStore";

export type LessonOutcome = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";

export interface TradeLesson {
  id: string;
  tradeId: string;
  symbol: string;
  position: "LONG" | "SHORT" | "SPOT";
  outcome: LessonOutcome;
  pnlPercent?: number;
  timeframe?: string;
  rootCause: string;
  mistakes: string[];
  strengths: string[];
  lesson: string;
  tags: string[];
  emotion?: string;
  timestamp: string;
}

const EMPTY: TradeLesson[] = [];

const lessonsStore = createLocalStore<TradeLesson[]>("alphaboard_trade_lessons", EMPTY, {
  parse: (raw) => (Array.isArray(raw) ? (raw as TradeLesson[]).filter((l) => l && typeof l.id === "string") : EMPTY),
});

export function useTradeLessons() {
  const lessons = useLocalStore(lessonsStore);

  const addLesson = useCallback((lesson: Omit<TradeLesson, "id" | "timestamp">) => {
    const entry: TradeLesson = { ...lesson, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
    lessonsStore.update((prev) => [entry, ...prev.filter((l) => l.tradeId !== entry.tradeId)].slice(0, 200));
    return entry;
  }, []);

  const removeLesson = useCallback((id: string) => { lessonsStore.update((prev) => prev.filter((l) => l.id !== id)); }, []);
  const clearLessons = useCallback(() => { lessonsStore.update(() => []); }, []);

  return { lessons, addLesson, removeLesson, clearLessons };
}

/**
 * Read lessons synchronously (for non-hook contexts, e.g. building an API payload).
 * Same-symbol lessons first, then the most recent others.
 */
export function getRelevantLessons({ symbol, limit = 6 }: { symbol?: string; limit?: number } = {}): TradeLesson[] {
  const sorted = [...lessonsStore.read()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (!symbol) return sorted.slice(0, limit);
  return [...sorted.filter((l) => l.symbol === symbol), ...sorted.filter((l) => l.symbol !== symbol)].slice(0, limit);
}
