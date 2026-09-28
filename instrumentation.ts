export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logBoot } = await import("./lib/http/boot");
  logBoot();
  const { startScheduler } = await import("./lib/jobs/scheduler");
  startScheduler();
}
