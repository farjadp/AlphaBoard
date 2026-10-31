/** The shared rate-limit store against Postgres: refill arithmetic, cross-call budget, prune. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { checkRateLimitInDb, pruneRateLimits } from "@/lib/http/rateLimit";

const run = !!process.env.TEST_DATABASE_URL;
const key = (s: string) => `test:${s}:${Date.now()}`;

describe.skipIf(!run)("rate limit store (Postgres)", () => {
  beforeAll(async () => { await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "test:" } } }); });
  afterAll(async () => { await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "test:" } } }); });

  it("allows `limit` hits per window and then blocks with a retry hint", async () => {
    const k = key("public"); // public tier: 5 per hour
    for (let i = 0; i < 5; i++) expect((await checkRateLimitInDb(k, "public")).allowed).toBe(true);
    const blocked = await checkRateLimitInDb(k, "public");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60 * 60_000 / 5 + 1000);
  });

  it("refills from the stored timestamp", async () => {
    const k = key("api"); // 300/min → 5 tokens per second
    await checkRateLimitInDb(k, "api");
    await prisma.rateLimitBucket.update({ where: { key: k }, data: { tokens: 0, updatedAt: new Date(Date.now() - 2_000) } });
    const r = await checkRateLimitInDb(k, "api");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeGreaterThanOrEqual(8); // ≈10 refilled, 1 taken
  });

  it("prunes rows idle longer than the longest window", async () => {
    const k = key("old");
    await checkRateLimitInDb(k, "api");
    await prisma.rateLimitBucket.update({ where: { key: k }, data: { updatedAt: new Date(Date.now() - 2 * 60 * 60_000) } });
    const n = await pruneRateLimits();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: k } })).toBeNull();
  });
});
