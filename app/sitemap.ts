import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Built per request so APP_URL comes from the runtime environment (it is not set at image build time).
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/legal`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
