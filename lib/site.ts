/** Public base URL for absolute links (sitemap, OG). Set APP_URL in production. */
export function siteUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
