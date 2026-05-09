"use client";

import { useState, useEffect } from "react";

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: "above" | "below";
  createdAt: string;
  triggered: boolean;
  triggeredAt?: string;
}

const STORAGE_KEY = "alphaboard_price_alerts";

export function useAlerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setAlerts(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load alerts", e);
    }
  }, []);

  // Save to localStorage whenever alerts change
  const saveAlerts = (newAlerts: PriceAlert[]) => {
    setAlerts(newAlerts);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newAlerts));
    } catch (e) {
      console.error("Failed to save alerts", e);
    }
  };

  const addAlert = (symbol: string, targetPrice: number, condition: "above" | "below") => {
    const newAlert: PriceAlert = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      symbol,
      targetPrice,
      condition,
      createdAt: new Date().toISOString(),
      triggered: false,
    };
    saveAlerts([newAlert, ...alerts]);
  };

  const removeAlert = (id: string) => {
    saveAlerts(alerts.filter((a) => a.id !== id));
  };

  const markTriggered = (id: string) => {
    saveAlerts(
      alerts.map((a) =>
        a.id === id ? { ...a, triggered: true, triggeredAt: new Date().toISOString() } : a
      )
    );
  };

  return { alerts, addAlert, removeAlert, markTriggered };
}
