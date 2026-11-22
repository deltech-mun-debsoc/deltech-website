import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/app-url";
import { ARTICLES } from "@/content/newsletter/issue-01";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!APP_URL) return [];
  const paths = ["/", "/team", "/blog", "/availability", "/newsletter", ...ARTICLES.map((a) => `/newsletter/${a.slug}`)];
  return paths.map((path) => ({ url: `${APP_URL}${path === "/" ? "" : path}` }));
}
