/**
 * A tiny external store over localStorage, consumed with React's useSyncExternalStore.
 *
 * Why: v1's hooks loaded localStorage in useEffect and wrote from stale closures, which caused
 * lost updates (two alerts triggering at once), silent quota failures, and an extra render on
 * every mount. Reads here are synchronous and cached; writes report failure instead of pretending.
 * P2 swaps the persistence for the server behind the same hook APIs.
 */
import { useSyncExternalStore } from "react";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WriteResult { ok: boolean; quotaExceeded?: boolean; error?: unknown }

export interface LocalStore<T> {
  key: string;
  read(): T;
  update(fn: (prev: T) => T): WriteResult;
  subscribe(listener: () => void): () => void;
  serverSnapshot(): T;
}

const browserStorage = (): StorageLike | null => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};

export function createLocalStore<T>(
  key: string,
  fallback: T,
  opts: { parse?: (raw: unknown) => T; storage?: () => StorageLike | null } = {},
): LocalStore<T> {
  const getStorage = opts.storage ?? browserStorage;
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: T } | null = null;

  function read(): T {
    const storage = getStorage();
    if (!storage) return fallback;
    let raw: string | null = null;
    try { raw = storage.getItem(key); } catch { return fallback; }
    if (cache && cache.raw === raw) return cache.value;
    let value = fallback;
    if (raw !== null) {
      try { value = opts.parse ? opts.parse(JSON.parse(raw)) : (JSON.parse(raw) as T); } catch { value = fallback; }
    }
    cache = { raw, value };
    return value;
  }

  function update(fn: (prev: T) => T): WriteResult {
    const storage = getStorage();
    if (!storage) return { ok: false };
    const next = fn(read());
    const raw = JSON.stringify(next);
    try {
      storage.setItem(key, raw);
    } catch (error) {
      const quotaExceeded = error instanceof Error && error.name === "QuotaExceededError";
      return { ok: false, quotaExceeded, error };
    }
    cache = { raw, value: next };
    listeners.forEach((l) => l());
    return { ok: true };
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => { if (e.key === key) listener(); }; // other tabs
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  }

  return { key, read, update, subscribe, serverSnapshot: () => fallback };
}

export function useLocalStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.read, store.serverSnapshot);
}

const noopSubscribe = () => () => {};
/** false during SSR and hydration, true afterwards — without a setState-in-effect. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export const STORAGE_FULL_MESSAGE =
  "Browser storage is full, so the last change was NOT saved. Remove old screenshots or entries. (Server storage arrives in the next release.)";
