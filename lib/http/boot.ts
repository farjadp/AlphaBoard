import { appVersion } from "@/lib/config/version";
import { env } from "@/lib/env";
import { logger } from "./logger";

/** Called once per Node.js server start from instrumentation.ts. */
export function logBoot() {
  logger.info(
    { node: process.version, env: env().NODE_ENV, version: appVersion() },
    "alphaboard booting",
  );
}
