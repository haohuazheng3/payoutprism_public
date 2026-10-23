import type { MetadataRoute } from "next";
import { isIndexable } from "@/lib/env";
import { PRIVATE_PATHS, SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return { rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] }], sitemap: `${SITE.url}/sitemap.xml`, host: SITE.url };
}
