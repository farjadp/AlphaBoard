import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** Only the public pages are indexable; everything else sits behind a login anyway. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/$", "/legal", "/opengraph-image"], disallow: "/" },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
