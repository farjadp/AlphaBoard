import { describe, it, expect, vi } from "vitest";
import { createMemo } from "@/lib/market/cache";

describe("createMemo (TTL cache + in-flight dedupe)", () => {
  it("returns cached value within TTL and reloads after expiry", async () => {
    let now = 0;
    const memo = createMemo({ now: () => now });
    const loader = vi.fn(async () => now);
    expect(await memo("k", 1000, loader)).toBe(0);
    now = 500;
    expect(await memo("k", 1000, loader)).toBe(0);
    expect(loader).toHaveBeenCalledTimes(1);
    now = 1001;
    expect(await memo("k", 1000, loader)).toBe(1001);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent loads of the same key into one upstream call", async () => {
    const memo = createMemo();
    let resolve!: (v: number) => void;
    const loader = vi.fn(() => new Promise<number>((r) => { resolve = r; }));
    const a = memo("k", 1000, loader);
    const b = memo("k", 1000, loader);
    resolve(42);
    expect(await a).toBe(42);
    expect(await b).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures, but serves a stale value if the refresh fails", async () => {
    let now = 0;
    const memo = createMemo({ now: () => now, staleIfErrorMs: 10_000 });
    expect(await memo("k", 1000, async () => "fresh")).toBe("fresh");
    now = 2000;
    expect(await memo("k", 1000, async () => { throw new Error("upstream down"); })).toBe("fresh");
    now = 20_000;
    await expect(memo("k", 1000, async () => { throw new Error("upstream down"); })).rejects.toThrow("upstream down");
  });
});
