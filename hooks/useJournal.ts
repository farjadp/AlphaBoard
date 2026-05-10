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
  pnlPercent?: number;
  emotion: TradeEmotion;
  notes: string;
  leverage?: number;
  margin?: number;
  marginMode?: "Cross" | "Isolated";
  status: "OPEN" | "CLOSED";
  screenshotUrl?: string; // base64 data URL of post-mortem screenshot
  postMortem?: PostMortemAnalysis;
}

const STORAGE_KEY = "alphaboard_trading_journal";

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

  const addEntry = (entryData: Omit<JournalEntry, "id" | "timestamp" | "pnlPercent" | "status">) => {
    let pnl: number | undefined = undefined;
    let status: "OPEN" | "CLOSED" = "OPEN";

    // Calculate PnL % if exit price exists
    if (entryData.exitPrice && entryData.exitPrice > 0) {
      status = "CLOSED";
      const diff = entryData.exitPrice - entryData.entryPrice;
      pnl = (diff / entryData.entryPrice) * 100;
      if (entryData.position === "SHORT") {
        pnl = -pnl; // Inverse for shorts
      }
      if (entryData.leverage && entryData.leverage > 0) {
        pnl = pnl * entryData.leverage;
      }
    }

    const newEntry: JournalEntry = {
      ...entryData,
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      pnlPercent: pnl,
      status,
    };

    saveEntries([newEntry, ...entries]);
  };

  const updateEntry = (id: string, updates: Partial<JournalEntry>) => {
    saveEntries(
      entries.map((e) => {
        if (e.id === id) {
          const updated = { ...e, ...updates };
          
          // Recalculate PnL if exit price is added/changed
          if (updated.exitPrice && updated.exitPrice > 0) {
            updated.status = "CLOSED";
            const diff = updated.exitPrice - updated.entryPrice;
            updated.pnlPercent = (diff / updated.entryPrice) * 100;
            if (updated.position === "SHORT") {
              updated.pnlPercent = -updated.pnlPercent;
            }
            if (updated.leverage && updated.leverage > 0) {
              updated.pnlPercent = updated.pnlPercent * updated.leverage;
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
