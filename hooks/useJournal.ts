"use client";

import { useState, useEffect } from "react";

export type TradePosition = "LONG" | "SHORT" | "SPOT";
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

/** Default taker fee per side (e.g. 0.05% on Binance/Bybit/Ourbit futures). Round-trip cost = 2× this × leverage. */
export const DEFAULT_FEE_RATE_PERCENT = 0.05;

const STORAGE_KEY = "alphaboard_trading_journal";

/**
 * Compute net PnL% from raw trade inputs, deducting round-trip taker fees.
 * Fees in % of margin = feeRate × 2 × leverage (entry + exit, both at leverage).
 */
export function computePnl(params: {
  entryPrice: number;
  exitPrice: number;
  position: TradePosition;
  leverage?: number;
  feeRatePercent?: number;
}): { gross: number; net: number; feeImpact: number } {
  const { entryPrice, exitPrice, position, leverage, feeRatePercent } = params;
  const feeRate = typeof feeRatePercent === "number" ? feeRatePercent : DEFAULT_FEE_RATE_PERCENT;
  const lev = leverage && leverage > 0 ? leverage : 1;
  const diff = exitPrice - entryPrice;
  let gross = (diff / entryPrice) * 100;
  if (position === "SHORT") gross = -gross;
  gross = gross * lev;
  const feeImpact = feeRate * 2 * lev; // % of margin consumed by round-trip fees
  const net = gross - feeImpact;
  return { gross, net, feeImpact };
}

export function useJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setEntries(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load journal", e);
    }
  }, []);

  const saveEntries = (newEntries: JournalEntry[]) => {
    setEntries(newEntries);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newEntries));
    } catch (e) {
      console.error("Failed to save journal", e);
    }
  };

  const addEntry = (entryData: Omit<JournalEntry, "id" | "timestamp" | "status"> & { pnlPercent?: number; pnlSource?: JournalEntry["pnlSource"] }) => {
    let netPnl: number | undefined = entryData.pnlPercent;
    let grossPnl: number | undefined;
    let status: "OPEN" | "CLOSED" = "OPEN";
    const exchangeProvided = entryData.pnlSource === "exchange" && typeof entryData.pnlPercent === "number";

    if (entryData.exitPrice && entryData.exitPrice > 0) {
      status = "CLOSED";
      const { gross, net } = computePnl({
        entryPrice: entryData.entryPrice,
        exitPrice: entryData.exitPrice,
        position: entryData.position,
        leverage: entryData.leverage,
        feeRatePercent: entryData.feeRatePercent,
      });
      grossPnl = gross;
      if (!exchangeProvided) netPnl = net;
    } else if (exchangeProvided) {
      // Exchange PnL was provided but no exit price — still mark as closed.
      status = "CLOSED";
    }

    const newEntry: JournalEntry = {
      ...entryData,
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      pnlPercent: netPnl,
      grossPnlPercent: grossPnl,
      pnlSource: exchangeProvided ? "exchange" : (typeof netPnl === "number" ? "calculated" : undefined),
      status,
    };

    saveEntries([newEntry, ...entries]);
  };

  const updateEntry = (id: string, updates: Partial<JournalEntry>) => {
    saveEntries(
      entries.map((e) => {
        if (e.id === id) {
          const updated = { ...e, ...updates };

          // If caller explicitly set pnlSource === "exchange" and pnlPercent, honor it and skip formula.
          const exchangeLocked = updated.pnlSource === "exchange" && typeof updated.pnlPercent === "number";

          if (updated.exitPrice && updated.exitPrice > 0) {
            updated.status = "CLOSED";
            const { gross, net } = computePnl({
              entryPrice: updated.entryPrice,
              exitPrice: updated.exitPrice,
              position: updated.position,
              leverage: updated.leverage,
              feeRatePercent: updated.feeRatePercent,
            });
            updated.grossPnlPercent = gross;
            if (!exchangeLocked) {
              updated.pnlPercent = net;
              updated.pnlSource = "calculated";
            }
          }
          return updated;
        }
        return e;
      })
    );
  };

  const removeEntry = (id: string) => {
    saveEntries(entries.filter((e) => e.id !== id));
  };

  const clearJournal = () => {
    saveEntries([]);
  };

  return { entries, addEntry, removeEntry, updateEntry, clearJournal };
}
