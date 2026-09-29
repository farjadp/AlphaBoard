"use client";

import { useCallback } from "react";
import { createResource, jsonRequest, tempId, useResource } from "@/lib/client/resource";
import { withDerivedPnl } from "@/lib/journal/derive";
import { computePnl, DEFAULT_FEE_RATE_PERCENT } from "@/lib/journal/pnl";
import type { JournalEntry, PostMortemAnalysis, TradeEmotion, TradePosition } from "@/lib/types/userData";

export { computePnl, DEFAULT_FEE_RATE_PERCENT };
export type { JournalEntry, PostMortemAnalysis, TradeEmotion, TradePosition };

const EMPTY: JournalEntry[] = [];
const journalResource = createResource<JournalEntry[]>("/api/journal", { fallback: EMPTY, select: (j) => (j as { entries: JournalEntry[] }).entries });

type NewEntry = Omit<JournalEntry, "id" | "timestamp" | "status">;

export function useJournal() {
  const { data: entries, loaded, error } = useResource(journalResource);

  const addEntry = useCallback((entryData: NewEntry) => {
    const tmp = withDerivedPnl({ ...entryData, id: tempId(), timestamp: new Date().toISOString(), status: "OPEN" });
    return journalResource.mutate<{ entry: JournalEntry }>({
      optimistic: (d) => [tmp, ...d],
      request: jsonRequest("/api/journal", "POST", entryData),
      apply: (d, body) => d.map((e) => (e.id === tmp.id ? body.entry : e)),
    }).then(() => true, () => false);
  }, []);

  /** A data-URL screenshotUrl uploads a new screenshot; the server returns the stored URL. */
  const updateEntry = useCallback((id: string, updates: Partial<JournalEntry>) => {
    return journalResource.mutate<{ entry: JournalEntry }>({
      optimistic: (d) => d.map((e) => (e.id === id ? withDerivedPnl({ ...e, ...updates }) : e)),
      request: jsonRequest(`/api/journal/${id}`, "PATCH", updates),
      apply: (d, body) => d.map((e) => (e.id === id ? body.entry : e)),
    }).then(() => true, () => false);
  }, []);

  const removeEntry = useCallback((id: string) => journalResource.mutate({
    optimistic: (d) => d.filter((e) => e.id !== id),
    request: jsonRequest(`/api/journal/${id}`, "DELETE"),
  }).then(() => true, () => false), []);

  const clearJournal = useCallback(() => journalResource.mutate({
    optimistic: () => [],
    request: jsonRequest("/api/journal", "DELETE"),
  }).then(() => true, () => false), []);

  return { entries, loaded, addEntry, removeEntry, updateEntry, clearJournal, storageError: error };
}
