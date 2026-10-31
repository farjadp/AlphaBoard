import { env } from "@/lib/env";
/** Short build identifier shown by /api/health and Admin → System. */
export function appVersion(): string {
  return env().APP_VERSION ?? env().VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
