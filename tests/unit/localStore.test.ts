import { describe, it, expect, vi } from "vitest";
import { createLocalStore, type StorageLike } from "@/lib/client/localStore";

function fakeStorage(opts: { quotaBytes?: number } = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.quotaBytes !== undefined && v.length > opts.quotaBytes) {
        throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      }
      data.set(k, v);
    },
  };
}

describe("createLocalStore", () => {
  it("returns the fallback for missing, malformed or rejected values", () => {
    const storage = fakeStorage();
    const fallback: string[] = [];
    const store = createLocalStore("k", fallback, { storage: () => storage, parse: (v) => { if (!Array.isArray(v)) throw new Error("bad"); return v as string[]; } });
    expect(store.read()).toBe(fallback);
    storage.data.set("k", "{not json");
    expect(store.read()).toBe(fallback);
    storage.data.set("k", JSON.stringify({ not: "an array" }));
    expect(store.read()).toBe(fallback);
  });

  it("keeps referential identity until the stored value changes (required by useSyncExternalStore)", () => {
    const storage = fakeStorage();
    const store = createLocalStore<number[]>("k", [], { storage: () => storage });
    store.update(() => [1, 2]);
    const a = store.read();
    expect(store.read()).toBe(a);
    store.update((prev) => [...prev, 3]);
    expect(store.read()).not.toBe(a);
    expect(store.read()).toEqual([1, 2, 3]);
  });

  it("notifies subscribers after a successful write", () => {
    const storage = fakeStorage();
    const store = createLocalStore<number>("k", 0, { storage: () => storage });
    const cb = vi.fn();
    const unsubscribe = store.subscribe(cb);
    store.update((n) => n + 1);
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.update((n) => n + 1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("reports quota failures and leaves the persisted value untouched", () => {
    const storage = fakeStorage({ quotaBytes: 10 });
    const store = createLocalStore<string>("k", "", { storage: () => storage });
    expect(store.update(() => "ok").ok).toBe(true);
    const cb = vi.fn();
    store.subscribe(cb);
    const res = store.update(() => "x".repeat(100));
    expect(res.ok).toBe(false);
    expect(res.quotaExceeded).toBe(true);
    expect(store.read()).toBe("ok");
    expect(cb).not.toHaveBeenCalled();
  });

  it("picks up values written elsewhere (another tab) on the next read", () => {
    const storage = fakeStorage();
    const store = createLocalStore<number>("k", 0, { storage: () => storage });
    storage.data.set("k", "42");
    expect(store.read()).toBe(42);
  });

  it("serves the fallback on the server (no storage available)", () => {
    const store = createLocalStore<number>("k", 7, { storage: () => null });
    expect(store.read()).toBe(7);
    expect(store.update(() => 8).ok).toBe(false);
  });
});
