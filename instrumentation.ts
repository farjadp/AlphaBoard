import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logBoot } = await import("./lib/http/boot");
  logBoot();
  // Background work runs here unless a separate worker process is deployed (WORKER_MODE=separate).
  // Vercel functions are short-lived, so there the worker always runs elsewhere (fly.toml).
  if (process.env.WORKER_MODE === "separate" || process.env.VERCEL) return;
  const { startWorker } = await import("./lib/worker");
  startWorker();
}

/** Server render / action errors → admin dashboard "Recent errors" (API route errors are recorded by route()). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const e = err as Error & { digest?: string };
  const { recordEvent } = await import("./lib/ops/events");
  await recordEvent({
    source: "render",
    message: `${request.method} ${request.path.split("?")[0]}: ${e.message}`,
    meta: { routePath: context.routePath, routeType: context.routeType, digest: e.digest },
  });
};
