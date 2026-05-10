"use client";

import { useState, useEffect, useCallback } from "react";

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

const STORAGE_KEY = "alphaboard_trade_lessons";

function readFromStorage(): TradeLesson[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as TradeLesson[]) : [];
  } catch {
    return [];
  }
}

function writeToStorage(lessons: TradeLesson[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lessons));
  } catch (err) {
    console.error("Failed to persist trade lessons", err);
  }
}

export function useTradeLessons() {
  const [lessons, setLessons] = useState<TradeLesson[]>([]);

  useEffect(() => {
    setLessons(readFromStorage());
  }, []);

  const addLesson = useCallback((lesson: Omit<TradeLesson, "id" | "timestamp">) => {
    const newLesson: TradeLesson = {
      ...lesson,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    setLessons((prev) => {
      const filtered = prev.filter((item) => item.tradeId !== newLesson.tradeId);
      const updated = [newLesson, ...filtered].slice(0, 200);
      writeToStorage(updated);
      return updated;
    });
    return newLesson;
  }, []);

  const removeLesson = useCallback((id: string) => {
    setLessons((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      writeToStorage(updated);
      return updated;
    });
  }, []);

  const clearLessons = useCallback(() => {
    setLessons([]);
    writeToStorage([]);
  }, []);

  return { lessons, addLesson, removeLesson, clearLessons };
}

/**
 * Read lessons synchronously (for non-hook contexts, e.g. building an API payload).
 * Returns the most recent lessons sorted by timestamp desc.
 */
export function getRelevantLessons({ symbol, limit = 6 }: { symbol?: string; limit?: number } = {}): TradeLesson[] {
  const all = readFromStorage();
  const sorted = [...all].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (!symbol) return sorted.slice(0, limit);
  const sameSymbol = sorted.filter((item) => item.symbol === symbol);
  const others = sorted.filter((item) => item.symbol !== symbol);
  return [...sameSymbol, ...others].slice(0, limit);
}
