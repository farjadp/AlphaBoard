import { logger } from "./logger";

/** Called once per Node.js server start from instrumentation.ts. */
export function logBoot() {
  logger.info(
    { node: process.version, env: process.env.NODE_ENV, version: process.env.APP_VERSION ?? "dev" },
    "alphaboard booting",
  );
}
