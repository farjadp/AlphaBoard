/** Short build identifier shown by /api/health and Admin → System. */
export function appVersion(): string {
  return process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
