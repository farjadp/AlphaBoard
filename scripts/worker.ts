/**
 * Standalone worker (WORKER_MODE=separate): `npm run worker`.
 * Runs with the react-server condition so `server-only` imports resolve to their empty module.
 */
import { startWorker } from "@/lib/worker";
import { logger } from "@/lib/http/logger";

const w = startWorker();
const shutdown = async (signal: string) => {
  logger.info({ signal }, "worker stopping");
  await w?.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// Keep the process alive: the worker's timers are unref'd so the web server can exit cleanly.
setInterval(() => undefined, 60_000);
