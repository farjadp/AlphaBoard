import { appUrl } from "@/lib/env";
/** Public base URL for absolute links (sitemap, OG). Set APP_URL in production. */
export function siteUrl(): string {
  return appUrl();
}
