/**
 * Small TTL cache with in-flight de-duplication and stale-if-error.
 * One instance per server process; used to protect Yahoo/Binance/CoinGecko from
 * repeated identical requests (many users, many timeframes, polling UIs).
 */
interface Entry<T> { value: T; expiresAt: number; storedAt: number }

export interface MemoOptions {
  now?: () => number;
  maxEntries?: number;
  /** When a refresh fails, keep serving the last good value for this long after it expired. */
  staleIfErrorMs?: number;
}

export type Memo = <T>(key: string, ttlMs: number, loader: () => Promise<T>) => Promise<T>;

export function createMemo(opts: MemoOptions = {}): Memo {
  const now = opts.now ?? Date.now;
  const maxEntries = opts.maxEntries ?? 1_000;
  const staleIfErrorMs = opts.staleIfErrorMs ?? 0;
  const store = new Map<string, Entry<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();

  function set(key: string, value: unknown, ttlMs: number) {
    store.delete(key);
    store.set(key, { value, expiresAt: now() + ttlMs, storedAt: now() });
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  return async function memo<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const hit = store.get(key) as Entry<T> | undefined;
    if (hit && hit.expiresAt > now()) return hit.value;

    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const p = (async () => {
      try {
        const value = await loader();
        set(key, value, ttlMs);
        return value;
      } catch (err) {
        if (hit && now() - hit.expiresAt <= staleIfErrorMs) return hit.value;
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };
}

/** Process-wide cache for market data. Serves stale data up to 10 minutes if a provider is down. */
export const marketMemo = createMemo({ maxEntries: 2_000, staleIfErrorMs: 10 * 60_000 });
