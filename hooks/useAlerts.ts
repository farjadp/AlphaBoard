"use client";

import { useCallback } from "react";
import { createLocalStore, useLocalStore } from "@/lib/client/localStore";

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: "above" | "below";
  createdAt: string;
  triggered: boolean;
  triggeredAt?: string;
}

const EMPTY: PriceAlert[] = [];

const alertsStore = createLocalStore<PriceAlert[]>("alphaboard_price_alerts", EMPTY, {
  parse: (raw) => (Array.isArray(raw) ? (raw as PriceAlert[]).filter((a) => a && typeof a.id === "string" && typeof a.targetPrice === "number") : EMPTY),
});

export function useAlerts() {
  const alerts = useLocalStore(alertsStore);

  const addAlert = useCallback((symbol: string, targetPrice: number, condition: "above" | "below") => {
    const alert: PriceAlert = {
      id: crypto.randomUUID(),
      symbol,
      targetPrice,
      condition,
      createdAt: new Date().toISOString(),
      triggered: false,
    };
    alertsStore.update((prev) => [alert, ...prev]);
  }, []);

  const removeAlert = useCallback((id: string) => {
    alertsStore.update((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /** Idempotent and always applied to the latest state, so several alerts can fire in one tick. */
  const markTriggered = useCallback((id: string) => {
    alertsStore.update((prev) =>
      prev.map((a) => (a.id === id && !a.triggered ? { ...a, triggered: true, triggeredAt: new Date().toISOString() } : a)),
    );
  }, []);

  return { alerts, addAlert, removeAlert, markTriggered };
}
