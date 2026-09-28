"use client";

import { useCallback } from "react";
import { createResource, jsonRequest, tempId, useResource } from "@/lib/client/resource";
import type { PriceAlert } from "@/lib/types/userData";

export type { PriceAlert };

const EMPTY: PriceAlert[] = [];
const alertsResource = createResource<PriceAlert[]>("/api/alerts", { fallback: EMPTY, select: (j) => (j as { alerts: PriceAlert[] }).alerts });

const replace = (list: PriceAlert[], id: string, next: PriceAlert | null) =>
  next ? list.map((a) => (a.id === id ? next : a)) : list;

export function useAlerts() {
  const { data: alerts, loaded, error } = useResource(alertsResource);

  const addAlert = useCallback((symbol: string, targetPrice: number, condition: "above" | "below") => {
    const tmp: PriceAlert = { id: tempId(), symbol, targetPrice, condition, createdAt: new Date().toISOString(), triggered: false };
    return alertsResource.mutate<{ alert: PriceAlert }>({
      optimistic: (d) => [tmp, ...d],
      request: jsonRequest("/api/alerts", "POST", { symbol, targetPrice, condition }),
      apply: (d, body) => replace(d, tmp.id, body.alert),
    }).catch(() => undefined);
  }, []);

  const removeAlert = useCallback((id: string) => alertsResource.mutate({
    optimistic: (d) => d.filter((a) => a.id !== id),
    request: jsonRequest(`/api/alerts/${id}`, "DELETE"),
  }).catch(() => undefined), []);

  /** Idempotent on the server, so several alerts firing in one tick are all recorded. */
  const markTriggered = useCallback((id: string) => {
    if (id.startsWith("tmp-")) return;
    return alertsResource.mutate<{ alert: PriceAlert | null }>({
      optimistic: (d) => d.map((a) => (a.id === id && !a.triggered ? { ...a, triggered: true, triggeredAt: new Date().toISOString() } : a)),
      request: jsonRequest(`/api/alerts/${id}`, "PATCH"),
      apply: (d, body) => replace(d, id, body.alert),
    }).catch(() => undefined);
  }, []);

  return { alerts, loaded, error, addAlert, removeAlert, markTriggered };
}
