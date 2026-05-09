"use client";

import { useState, useEffect } from "react";

export interface ArchivedSignal {
  id: string;
  timestamp: string; // Precise ISO string
  symbol: string;
  price: number;
  signal: string;
  confidence: number;
  timeframe: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  indicators_breakdown?: Array<{
    name: string;
    value: string;
    signal: "Bullish" | "Bearish" | "Neutral";
    explanation: string;
  }>;
}

const STORAGE_KEY = "alphaboard_signal_history";

export function useSignalHistory() {
  const [history, setHistory] = useState<ArchivedSignal[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load signal history", e);
    }
  }, []);

  const archiveSignal = (signal: Omit<ArchivedSignal, "id" | "timestamp">) => {
    const newSignal: ArchivedSignal = {
      ...signal,
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
    };

    setHistory((prev) => {
      const updated = [newSignal, ...prev].slice(0, 500); // Keep last 500
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error("Failed to save signal history", e);
      }
      return updated;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const removeSignal = (id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  return { history, archiveSignal, clearHistory, removeSignal };
}
