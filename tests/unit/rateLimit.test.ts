import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@/lib/http/rateLimit";

describe("createRateLimiter (token bucket)", () => {
  it("allows up to `limit` hits inside the window and blocks the next one", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    expect(rl.check("1.2.3.4").allowed).toBe(true);
    expect(rl.check("1.2.3.4").allowed).toBe(true);
    expect(rl.check("1.2.3.4").allowed).toBe(true);

    const blocked = rl.check("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("keys are independent", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
  });

  it("refills after the window elapses", () => {
    let now = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
    rl.check("k"); rl.check("k");
    expect(rl.check("k").allowed).toBe(false);
    now += 1_000;
    expect(rl.check("k").allowed).toBe(true);
  });

  it("evicts stale keys so memory does not grow unbounded", () => {
    let now = 0;
    const rl = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now, maxKeys: 2 });
    rl.check("a"); rl.check("b"); rl.check("c");
    expect(rl.size()).toBeLessThanOrEqual(2);
  });
});
