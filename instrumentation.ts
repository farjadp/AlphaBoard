export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("./lib/http/logger");
  logger.info(
    { node: process.version, env: process.env.NODE_ENV, version: process.env.APP_VERSION ?? "dev" },
    "alphaboard booting",
  );
}
