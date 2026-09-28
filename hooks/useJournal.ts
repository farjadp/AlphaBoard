"use client";

import { useCallback, useState } from "react";
import { createLocalStore, useLocalStore, STORAGE_FULL_MESSAGE, type WriteResult } from "@/lib/client/localStore";
import { computePnl, DEFAULT_FEE_RATE_PERCENT, type TradePosition } from "@/lib/journal/pnl";

export { computePnl, DEFAULT_FEE_RATE_PERCENT };
export type { TradePosition };
export type TradeEmotion = "Confident" | "FOMO" | "Panic" | "Neutral" | "Greed" | "Revenge";

export interface PostMortemAnalysis {
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";
  rootCause: string;
  mistakes: string[];
  strengths: string[];
  lesson: string;
  tags: string[];
  generatedAt: string;
}

export interface JournalEntry {
  id: string;
  timestamp: string; // ISO String
  symbol: string;
  position: TradePosition;
  entryPrice: number;
  exitPrice?: number;
  pnlPercent?: number; // NET pnl% (after fees)
  grossPnlPercent?: number; // GROSS pnl% (raw price move × leverage)
  feeRatePercent?: number; // per-side taker fee % (e.g. 0.05 for 0.05%). Undefined = use DEFAULT_FEE_RATE_PERCENT
  pnlSource?: "calculated" | "exchange"; // "exchange" means pnlPercent was provided directly (e.g. from screenshot) and should not be recomputed
  emotion: TradeEmotion;
  notes: string;
  leverage?: number;
  margin?: number;
  marginMode?: "Cross" | "Isolated";
  status: "OPEN" | "CLOSED";
  screenshotUrl?: string; // base64 data URL of post-mortem screenshot
  postMortem?: PostMortemAnalysis;
}

const EMPTY: JournalEntry[] = [];

const journalStore = createLocalStore<JournalEntry[]>("alphaboard_trading_journal", EMPTY, {
  parse: (raw) => (Array.isArray(raw) ? (raw as JournalEntry[]).filter((e) => e && typeof e.id === "string") : EMPTY),
});

/** Recompute status/PnL for an entry from its raw fields (exchange-provided PnL is never overwritten). */
function withDerivedPnl(entry: JournalEntry): JournalEntry {
  const next = { ...entry };
  const exchangeLocked = next.pnlSource === "exchange" && typeof next.pnlPercent === "number";
  if (next.exitPrice && next.exitPrice > 0) {
    next.status = "CLOSED";
    const pnl = computePnl({
      entryPrice: next.entryPrice,
      exitPrice: next.exitPrice,
      position: next.position,
      leverage: next.leverage,
      feeRatePercent: next.feeRatePercent,
    });
    if (pnl) {
      next.grossPnlPercent = pnl.gross;
      if (!exchangeLocked) {
        next.pnlPercent = pnl.net;
        next.pnlSource = "calculated";
      }
    }
  } else if (exchangeLocked) {
    next.status = "CLOSED"; // exchange PnL without an exit price still means the trade closed
  }
  return next;
}

export function useJournal() {
  const entries = useLocalStore(journalStore);
  const [storageError, setStorageError] = useState<string | null>(null);

  // v1 swallowed quota errors: the UI looked saved, then the data vanished on reload.
  const commit = useCallback((fn: (prev: JournalEntry[]) => JournalEntry[]) => {
    const res: WriteResult = journalStore.update(fn);
    setStorageError(res.ok ? null : res.quotaExceeded ? STORAGE_FULL_MESSAGE : "The journal could not be saved in this browser.");
    return res.ok;
  }, []);

  const addEntry = useCallback((entryData: Omit<JournalEntry, "id" | "timestamp" | "status"> & { pnlPercent?: number; pnlSource?: JournalEntry["pnlSource"] }) => {
    const exchangeProvided = entryData.pnlSource === "exchange" && typeof entryData.pnlPercent === "number";
    const entry = withDerivedPnl({
      ...entryData,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      status: "OPEN",
      pnlSource: exchangeProvided ? "exchange" : undefined,
    });
    return commit((prev) => [entry, ...prev]);
  }, [commit]);

  const updateEntry = useCallback((id: string, updates: Partial<JournalEntry>) => {
    return commit((prev) => prev.map((e) => (e.id === id ? withDerivedPnl({ ...e, ...updates }) : e)));
  }, [commit]);

  const removeEntry = useCallback((id: string) => commit((prev) => prev.filter((e) => e.id !== id)), [commit]);
  const clearJournal = useCallback(() => commit(() => []), [commit]);

  return { entries, addEntry, removeEntry, updateEntry, clearJournal, storageError };
}
