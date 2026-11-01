import { prisma } from "@/lib/db/client";
import { tooManyRequests } from "./errors";
import { logger } from "./logger";

/**
 * Token-bucket rate limiting. The pure in-memory limiter below is the algorithm (and the fallback);
 * `enforceRateLimit` runs the same arithmetic in one Postgres statement per request, so the budget is
 * shared by every Vercel instance and the worker. Keys are usually client IPs.
 */
export interface RateLimiterOptions {
  limit: number;      // tokens per window
  windowMs: number;   // refill period
  now?: () => number; // injectable clock for tests
  maxKeys?: number;   // LRU-ish cap to bound memory
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket { tokens: number; updatedAt: number }

export function createRateLimiter(opts: RateLimiterOptions) {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const refillPerMs = opts.limit / opts.windowMs;
  const buckets = new Map<string, Bucket>();

  function refill(b: Bucket, t: number) {
    const elapsed = Math.max(0, t - b.updatedAt);
    b.tokens = Math.min(opts.limit, b.tokens + elapsed * refillPerMs);
    b.updatedAt = t;
  }

  function evictIfNeeded() {
    if (buckets.size <= maxKeys) return;
    // Map preserves insertion order; drop the oldest entries first.
    const excess = buckets.size - maxKeys;
    let i = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++i >= excess) break;
    }
  }

  return {
    check(key: string): RateLimitResult {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: opts.limit, updatedAt: t };
        buckets.set(key, b);
        evictIfNeeded();
      } else {
        refill(b, t);
        // re-insert to refresh recency
        buckets.delete(key);
        buckets.set(key, b);
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
      }
      const retryAfterMs = Math.ceil((1 - b.tokens) / refillPerMs);
      return { allowed: false, remaining: 0, retryAfterMs };
    },
    size: () => buckets.size,
    reset: () => buckets.clear(),
  };
}

/** Best-effort client IP behind Vercel / reverse proxies. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

const TIERS = {
  auth: { limit: 10, windowMs: 15 * 60_000 },     // login/register: 10 per 15 min per IP
  ai: { limit: 20, windowMs: 10 * 60_000 },       // AI calls: 20 per 10 min per IP
  api: { limit: 300, windowMs: 60_000 },          // general API: 300/min per IP
  public: { limit: 5, windowMs: 60 * 60_000 },    // public forms (waitlist): 5 per hour per IP
} as const;
export type RateLimitTier = keyof typeof TIERS;

/** In-memory fallback, used only while the database is unreachable (keeps the app up, limits per instance). */
export const limiters = Object.fromEntries(
  (Object.keys(TIERS) as RateLimitTier[]).map((t) => [t, createRateLimiter(TIERS[t])]),
) as Record<RateLimitTier, ReturnType<typeof createRateLimiter>>;

/**
 * One statement: lock the row, refill by elapsed time, take a token when one is there, write back.
 * Returns the refilled balance and the balance after this call; allowed when they differ.
 */
export async function checkRateLimitInDb(key: string, tier: RateLimitTier, db = prisma): Promise<RateLimitResult> {
  const { limit, windowMs } = TIERS[tier];
  const refillPerMs = limit / windowMs;
  const rows = await db.$queryRaw<Array<{ refilled: number; tokens: number }>>`
    WITH cur AS (
      SELECT "tokens", "updatedAt" FROM "RateLimitBucket" WHERE "key" = ${key} FOR UPDATE
    ),
    calc AS (
      SELECT LEAST(${limit}::float8,
        COALESCE((SELECT "tokens" FROM cur), ${limit}::float8)
        + GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE((SELECT "updatedAt" FROM cur), now())))) * 1000 * ${refillPerMs}::float8
      ) AS refilled
    ),
    up AS (
      INSERT INTO "RateLimitBucket" ("key", "tokens", "updatedAt")
      SELECT ${key}, CASE WHEN refilled >= 1 THEN refilled - 1 ELSE refilled END, now() FROM calc
      ON CONFLICT ("key") DO UPDATE SET "tokens" = EXCLUDED."tokens", "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "tokens"
    )
    SELECT (SELECT refilled FROM calc) AS refilled, (SELECT "tokens" FROM up) AS tokens`;
  const r = rows[0];
  const allowed = r.refilled >= 1;
  return {
    allowed,
    remaining: Math.floor(r.tokens),
    retryAfterMs: allowed ? 0 : Math.ceil((1 - r.tokens) / refillPerMs),
  };
}

/** Rows idle for longer than any window are dead weight; the tick calls this. */
export async function pruneRateLimits(now = new Date(), db = prisma): Promise<number> {
  const oldest = Math.max(...Object.values(TIERS).map((t) => t.windowMs));
  const r = await db.rateLimitBucket.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - oldest) } } });
  return r.count;
}

let dbDownUntil = 0;

/** Throws HttpError(429) when the caller's IP exceeds the tier's budget. Shared store, memory fallback. */
export async function enforceRateLimit(req: Request, tier: RateLimitTier): Promise<void> {
  const ip = clientIp(req);
  let rl: RateLimitResult;
  if (Date.now() >= dbDownUntil) {
    try {
      rl = await checkRateLimitInDb(`${tier}:${ip}`, tier);
    } catch (err) {
      dbDownUntil = Date.now() + 30_000;
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "rate limit store unavailable; per-instance fallback for 30 s");
      rl = limiters[tier].check(ip);
    }
  } else {
    rl = limiters[tier].check(ip);
  }
  if (!rl.allowed) throw tooManyRequests(rl.retryAfterMs);
}
