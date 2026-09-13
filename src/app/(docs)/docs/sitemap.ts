import type { MetadataRoute } from "next"

import { ALL_PAGES } from "../_lib/nav"

// Served at /docs/sitemap.xml. Absolute URLs use the docs subdomain, because
// that is the hostname these pages are meant to be found under; the same
// content is reachable at deltechmun.in/docs through the host rewrite in
// next.config.ts.
const DOCS_ORIGIN = "https://docs.deltechmun.in"

export default function sitemap(): MetadataRoute.Sitemap {
  return ALL_PAGES.map((page) => ({
    url: DOCS_ORIGIN + page.href.replace(/^\/docs/, ""),
    changeFrequency: "monthly" as const,
    priority: page.href === "/docs" ? 1 : 0.7,
  }))
}
