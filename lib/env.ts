/**
 * Server environment, read once and validated. Every `process.env` read in lib/ goes through here, so a
 * typo in a flag name fails at boot instead of silently turning a kill switch off. Flags are on only
 * when set to exactly "1" (the convention production already uses for LIVE_TRADING_ENABLED).
 *
 * Build-time and edge code (next.config.ts, instrumentation.ts, prisma/seed.mjs) reads process.env
 * directly: it runs before or outside this module.
 */
import { z } from "zod";

const flag = z.string().optional().transform((v) => v === "1");
const text = z.string().trim().optional().transform((v) => (v ? v : undefined));

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  APP_URL: text,
  APP_VERSION: text,
  VERCEL_GIT_COMMIT_SHA: text,
  LOG_LEVEL: text,
  CRON_SECRET: text,

  WORKER_MODE: z.enum(["inline", "separate"]).optional(),
  TICK_DISABLED: flag,
  NEWS_DISABLED: flag,
  LAB_DISABLED: flag,

  LIVE_TRADING_ENABLED: flag,
  TRADING_HALT: flag,
  EXCHANGE_KEY_SECRET: text,

  TELEGRAM_BOT_TOKEN: text,
  SIGNAL_BOT_TOKEN: text,
  SIGNAL_CHANNEL_ID: text,
  SIGNAL_CHANNEL_USERNAME: text.transform((v) => v?.replace(/^@/, "")),

  AI_DEFAULT_PROVIDER: text,
  AI_DEFAULT_MODEL: text,
  CRYPTOPANIC_PLAN: text,
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

/** Parsed environment (memoised). Throws with the offending keys when a value is malformed. */
export function env(): Env {
  if (cached) return cached;
  const r = Schema.safeParse(process.env);
  if (!r.success) {
    const keys = r.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${keys}`);
  }
  if (!process.env.VITEST) cached = r.data;
  return r.data;
}

/** Tests change process.env between cases; call this after doing so. */
export function resetEnvCache() {
  cached = null;
}

/** Provider API keys and news keys are looked up by name from a table; this keeps that one read explicit. */
export function secretByName(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export const isProduction = () => env().NODE_ENV === "production";
export const isDevelopment = () => env().NODE_ENV === "development";

/** Public base URL without a trailing slash. */
export const appUrl = () => (env().APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
