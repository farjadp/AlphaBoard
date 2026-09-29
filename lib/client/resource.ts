/**
 * Minimal client cache for the signed-in user's server data, consumed via useSyncExternalStore.
 * - loads lazily on first subscriber, de-duplicates concurrent loads
 * - optimistic mutations, reconciled with the server's response
 * - on failure: surfaces the server's message and reloads the authoritative state
 */
import { useSyncExternalStore } from "react";

export interface ResourceState<T> { data: T; loaded: boolean; error: string | null }

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface Resource<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ResourceState<T>;
  getServerSnapshot(): ResourceState<T>;
  load(force?: boolean): Promise<void>;
  mutate<R = unknown>(m: { optimistic?: (d: T) => T; request: () => Promise<Response>; apply?: (d: T, body: R) => T }): Promise<R>;
  peek(): T;
  reset(): void;
  /** Reload if someone is watching and the last load is older than `minAgeMs`. */
  revalidate(now: number, minAgeMs: number): void;
}

const registry = new Set<Resource<unknown>>();

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error ?? `Request failed (HTTP ${res.status})`;
  } catch {
    return `Request failed (HTTP ${res.status})`;
  }
}

export function createResource<T>(url: string, opts: { fallback: T; select: (json: unknown) => T; fetcher?: Fetcher }): Resource<T> {
  const fetcher: Fetcher = opts.fetcher ?? ((input, init) => fetch(input, { credentials: "same-origin", ...init }));
  const initial: ResourceState<T> = { data: opts.fallback, loaded: false, error: null };
  let state = initial;
  let inflight: Promise<void> | null = null;
  let loadedAt = 0;
  // A failed mutation's message must survive the corrective reload; a load error must not outlive a good load.
  let errorFromLoad = false;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<ResourceState<T>>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  function load(force = false): Promise<void> {
    if (inflight) return inflight;
    if (state.loaded && !force) return Promise.resolve();
    inflight = (async () => {
      try {
        const res = await fetcher(url);
        if (!res.ok) throw new Error(await errorMessage(res));
        set({ data: opts.select(await res.json()), loaded: true, ...(errorFromLoad ? { error: null } : {}) });
        errorFromLoad = false;
        loadedAt = Math.max(loadedAt, Date.now());
      } catch (e) {
        errorFromLoad = true;
        set({ loaded: true, error: e instanceof Error ? e.message : "Failed to load" });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  const resource: Resource<T> = {
    subscribe(listener) {
      listeners.add(listener);
      if (!state.loaded) void load();
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    load,
    peek: () => state.data,
    async mutate<R>({ optimistic, request, apply }: { optimistic?: (d: T) => T; request: () => Promise<Response>; apply?: (d: T, body: R) => T }) {
      errorFromLoad = false;
      set(optimistic ? { data: optimistic(state.data), error: null } : { error: null });
      try {
        const res = await request();
        if (!res.ok) throw new Error(await errorMessage(res));
        const body = (res.status === 204 ? undefined : await res.json()) as R;
        if (apply) set({ data: apply(state.data, body) });
        return body;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Request failed";
        errorFromLoad = false;
        set({ error: message });
        void load(true); // server state wins
        throw new Error(message);
      }
    },
    reset() {
      state = initial;
      inflight = null;
      loadedAt = 0;
      errorFromLoad = false;
      listeners.forEach((l) => l());
    },
    revalidate(now, minAgeMs) {
      if (listeners.size === 0 || !state.loaded || inflight || now - loadedAt < minAgeMs) return;
      loadedAt = now;
      void load(true);
    },
  };
  registry.add(resource as Resource<unknown>);
  return resource;
}

export function useResource<T>(r: Resource<T>): ResourceState<T> {
  return useSyncExternalStore(r.subscribe, r.getSnapshot, r.getServerSnapshot);
}

const REVALIDATE_AFTER_MS = 30_000;

/** Refresh what is on screen when the user comes back to the tab (changes made on another device). */
export function revalidateAll(now = Date.now()) {
  registry.forEach((r) => r.revalidate(now, REVALIDATE_AFTER_MS));
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") revalidateAll(); });
}

/** Drop every cached resource (sign-out / account switch). */
export function resetAllResources() {
  registry.forEach((r) => r.reset());
}

export const tempId = () => `tmp-${crypto.randomUUID()}`;

export const jsonRequest = (url: string, method: string, body?: unknown) => () =>
  fetch(url, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
