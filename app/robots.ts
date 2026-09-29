import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Built per request so APP_URL comes from the runtime environment (it is not set at image build time).
export const dynamic = "force-dynamic";

/** Only the public pages are indexable; everything else sits behind a login anyway. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/$", "/legal", "/opengraph-image"], disallow: "/" },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
