import { tooManyRequests } from "./errors";

/**
 * In-memory sliding token bucket. Good enough for a single instance (Railway);
 * swap the store for Redis if we ever scale out. Keys are usually client IPs.
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

/** Best-effort client IP behind Railway / reverse proxies. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Shared limiters (module singletons survive across requests in one process).
export const limiters = {
  auth: createRateLimiter({ limit: 10, windowMs: 15 * 60_000 }),        // login/register: 10 per 15 min per IP
  ai: createRateLimiter({ limit: 20, windowMs: 10 * 60_000 }),          // AI calls: 20 per 10 min per IP
  api: createRateLimiter({ limit: 300, windowMs: 60_000 }),             // general API: 300/min per IP
};

/** Throws HttpError(429) when the caller's IP exceeds the tier's budget. */
export function enforceRateLimit(req: Request, tier: keyof typeof limiters): void {
  const rl = limiters[tier].check(clientIp(req));
  if (!rl.allowed) {
    throw tooManyRequests(rl.retryAfterMs);
  }
}
