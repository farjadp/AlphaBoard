"use client";

import { useCallback } from "react";
import { createLocalStore, useLocalStore } from "@/lib/client/localStore";

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
  tradeStyle?: string;
  risk_management?: {
    leverage: string;
    leverageReasoning: string;
    positionSize: string;
    sizeReasoning: string;
    riskRewardRatio: string;
    distanceToTarget: string;
  };
  reasoning: string;
  indicators_breakdown?: Array<{
    name: string;
    value: string;
    signal: "Bullish" | "Bearish" | "Neutral";
    explanation: string;
  }>;
}

const EMPTY: ArchivedSignal[] = [];
const MAX_SIGNALS = 500;

const historyStore = createLocalStore<ArchivedSignal[]>("alphaboard_signal_history", EMPTY, {
  parse: (raw) => (Array.isArray(raw) ? (raw as ArchivedSignal[]).filter((s) => s && typeof s.id === "string") : EMPTY),
});

export function useSignalHistory() {
  const history = useLocalStore(historyStore);

  const archiveSignal = useCallback((signal: Omit<ArchivedSignal, "id" | "timestamp">) => {
    const entry: ArchivedSignal = { ...signal, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
    const res = historyStore.update((prev) => [entry, ...prev].slice(0, MAX_SIGNALS));
    if (!res.ok) console.error("Failed to archive signal", res.error);
  }, []);

  const clearHistory = useCallback(() => { historyStore.update(() => []); }, []);
  const removeSignal = useCallback((id: string) => { historyStore.update((prev) => prev.filter((s) => s.id !== id)); }, []);

  return { history, archiveSignal, clearHistory, removeSignal };
}
