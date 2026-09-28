"use client";

import { useCallback } from "react";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";
import type { ArchivedSignal } from "@/lib/types/userData";

export type { ArchivedSignal };

const EMPTY: ArchivedSignal[] = [];
const signalsResource = createResource<ArchivedSignal[]>("/api/signals", { fallback: EMPTY, select: (j) => (j as { signals: ArchivedSignal[] }).signals });

/** Signals are archived by the server when /api/analyze runs; refresh any mounted archive view. */
export function invalidateSignals() {
  if (signalsResource.getSnapshot().loaded) void signalsResource.load(true);
}

export function useSignalHistory() {
  const { data: history, loaded, error } = useResource(signalsResource);

  const removeSignal = useCallback((id: string) => signalsResource.mutate({
    optimistic: (d) => d.filter((s) => s.id !== id),
    request: jsonRequest(`/api/signals/${id}`, "DELETE"),
  }).catch(() => undefined), []);

  const clearHistory = useCallback(() => signalsResource.mutate({
    optimistic: () => [],
    request: jsonRequest("/api/signals", "DELETE"),
  }).catch(() => undefined), []);

  return { history, loaded, error, clearHistory, removeSignal };
}
