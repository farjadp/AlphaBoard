"use client";

import { useSyncExternalStore } from "react";
import { LEGACY_KEYS, type LegacyInput } from "@/lib/import/legacy";

const noopSubscribe = () => () => {};
/** false during SSR/hydration, true afterwards (no setState-in-effect). */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function readLegacyStorage(): LegacyInput {
  const out: LegacyInput = {};
  for (const [name, key] of Object.entries(LEGACY_KEYS) as Array<[keyof typeof LEGACY_KEYS, string]>) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) out[name] = JSON.parse(raw);
    } catch {
      // unreadable value: treat as absent
    }
  }
  return out;
}

export function hasLegacyData(): boolean {
  try {
    return Object.values(LEGACY_KEYS).some((k) => {
      const v = window.localStorage.getItem(k);
      return !!v && v !== "[]";
    });
  } catch {
    return false;
  }
}

export function clearLegacyStorage() {
  for (const k of Object.values(LEGACY_KEYS)) {
    try { window.localStorage.removeItem(k); } catch { /* ignore */ }
  }
}
