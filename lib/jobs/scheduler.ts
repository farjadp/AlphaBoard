import { logger } from "@/lib/http/logger";

const INTERVAL_MS = 60_000;
const g = globalThis as unknown as { __alphaboardTick?: { timer: ReturnType<typeof setInterval>; running: boolean } };

/**
 * In-process 60s tick (spec D9). One per server process — the app runs as a single Railway instance;
 * /api/cron/tick exists for an external trigger if that ever changes. Overlapping runs are skipped.
 */
export function startScheduler() {
  if (g.__alphaboardTick || process.env.TICK_DISABLED === "1" || process.env.VITEST) return;
  const state = { running: false, timer: undefined as unknown as ReturnType<typeof setInterval> };
  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const { runTick } = await import("./tick");
      await runTick();
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : String(e) }, "tick failed");
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(run, INTERVAL_MS);
  state.timer.unref?.();
  g.__alphaboardTick = state;
  logger.info({ intervalMs: INTERVAL_MS }, "tick scheduler started");
}
