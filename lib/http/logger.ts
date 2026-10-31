import { env, isProduction } from "@/lib/env";
import pino from "pino";

const isProd = isProduction();

export const logger = pino({
  level: env().LOG_LEVEL ?? (isProd ? "info" : "debug"),
  base: { service: "alphaboard" },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash", "*.apiKey", "*.token"],
    censor: "[redacted]",
  },
  ...(isProd
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" } } }),
});


/** Per-request child logger. Reuses an inbound x-request-id when present. */
export function requestLogger(req: Request) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const url = new URL(req.url);
  return {
    requestId,
    log: logger.child({ requestId, method: req.method, path: url.pathname }),
  };
}
