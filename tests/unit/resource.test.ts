import { describe, it, expect, vi } from "vitest";
import { createResource } from "@/lib/client/resource";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createResource", () => {
  it("loads lazily on first subscribe and de-duplicates concurrent loads", async () => {
    const fetcher = vi.fn(async () => json({ items: [1, 2] }));
    const r = createResource<number[]>("/api/x", { fallback: [], select: (j) => (j as { items: number[] }).items, fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    r.subscribe(() => {});
    r.subscribe(() => {});
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r.getSnapshot()).toMatchObject({ data: [1, 2], loaded: true, error: null });
  });

  it("keeps the snapshot reference stable between changes (useSyncExternalStore contract)", async () => {
    const r = createResource<number[]>("/api/x", { fallback: [], select: () => [1], fetcher: async () => json({}) });
    r.subscribe(() => {});
    await tick();
    expect(r.getSnapshot()).toBe(r.getSnapshot());
  });

  it("applies optimistic updates immediately and reconciles with the server response", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ items: ["a"] }))
      .mockResolvedValueOnce(json({ item: "b-from-server" }, 201));
    const r = createResource<string[]>("/api/x", { fallback: [], select: (j) => (j as { items: string[] }).items, fetcher });
    r.subscribe(() => {});
    await tick();

    const p = r.mutate<{ item: string }>({
      optimistic: (d) => [...d, "b-temp"],
      request: () => fetcher("/api/x", { method: "POST" }),
      apply: (d, body) => d.map((x) => (x === "b-temp" ? body.item : x)),
    });
    expect(r.getSnapshot().data).toEqual(["a", "b-temp"]);
    await p;
    expect(r.getSnapshot().data).toEqual(["a", "b-from-server"]);
  });

  it("on failure: surfaces the server's message, then reloads the authoritative list", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ items: ["a"] }))
      .mockResolvedValueOnce(json({ error: "Too many active alerts (max 200)", code: "LIMIT" }, 400))
      .mockResolvedValueOnce(json({ items: ["a"] }));
    const r = createResource<string[]>("/api/x", { fallback: [], select: (j) => (j as { items: string[] }).items, fetcher });
    r.subscribe(() => {});
    await tick();

    await expect(r.mutate({ optimistic: (d) => [...d, "tmp"], request: () => fetcher("/api/x", { method: "POST" }) }))
      .rejects.toThrow("Too many active alerts");
    await tick();
    expect(r.getSnapshot().data).toEqual(["a"]);
    expect(r.getSnapshot().error).toBe("Too many active alerts (max 200)");
  });

  it("reset() drops cached data (used on sign-out)", async () => {
    const r = createResource<number[]>("/api/x", { fallback: [], select: () => [9], fetcher: async () => json({}) });
    r.subscribe(() => {});
    await tick();
    r.reset();
    expect(r.getSnapshot()).toMatchObject({ data: [], loaded: false });
  });
});

describe("revalidateAll (tab refocus)", () => {
  it("reloads only subscribed, loaded resources, at most once per interval", async () => {
    const { createResource: make, revalidateAll } = await import("@/lib/client/resource");
    const fetchA = vi.fn(async () => json({}));
    const fetchB = vi.fn(async () => json({}));
    const a = make<number>("/api/a", { fallback: 0, select: () => 1, fetcher: fetchA });
    make<number>("/api/b", { fallback: 0, select: () => 1, fetcher: fetchB }); // never subscribed
    a.subscribe(() => {});
    await tick();
    expect(fetchA).toHaveBeenCalledTimes(1);

    revalidateAll(Date.now() + 60_000);
    await tick();
    expect(fetchA).toHaveBeenCalledTimes(2);
    expect(fetchB).not.toHaveBeenCalled();

    revalidateAll(Date.now() + 61_000); // within the throttle window
    await tick();
    expect(fetchA).toHaveBeenCalledTimes(2);
  });
});
