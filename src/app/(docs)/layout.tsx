import Link from "next/link"
import type { Metadata } from "next"
import type { ReactNode } from "react"

import { ThemeToggle } from "@/app/(marketing)/_components/theme-toggle"
import { t } from "@/content/strings"
import { DocsMobileNav } from "./_components/docs-mobile-nav"
import { DocsPageHeader, DocsPager } from "./_components/docs-page-frame"
import { DocsSearch } from "./_components/docs-search"
import { DocsSidebar } from "./_components/docs-sidebar"
import { DocsToc } from "./_components/docs-toc"

// Absolute, not "/". On docs.deltechmun.in the host rewrite in next.config.ts
// maps "/" back onto /docs, so a relative link would return the reader to the
// docs index. NEXT_PUBLIC_APP_URL is baked into each environment's image.
const MAIN_SITE = process.env.NEXT_PUBLIC_APP_URL ?? "/"

export const metadata: Metadata = {
  title: {
    default: t("docs.title"),
    template: `%s · ${t("docs.title")}`,
  },
  description: t("docs.tagline"),
}

// The docs are public, so no auth shell and no theme cookie plumbing: this sits
// in the "site" theme area alongside marketing, and reuses that toggle. The
// class list is deliberately not `.admin-shell` or `.recruitment-shell` because
// those force `overflow: hidden` and square off .editorial-card, which is the
// operations look, not the reading look.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <a
        href="#docs-article"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        {t("docs.skipToContent")}
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[100rem] items-center gap-3 px-4 sm:px-6">
          <DocsMobileNav />
          <Link href="/docs" className="flex items-center gap-2.5">
            <span className="display flex size-9 items-center justify-center rounded-full border border-foreground/25 text-[0.9375rem]">
              {"D"}
            </span>
            <span className="leading-tight">
              <span className="block font-semibold">{t("brand.name")}</span>
              <span className="block text-[0.6875rem] tracking-[0.15em] text-muted-foreground uppercase">
                {t("docs.breadcrumbRoot")}
              </span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <DocsSearch />
            <a
              href={MAIN_SITE}
              className="hidden text-[0.875rem] text-muted-foreground transition-colors hover:text-foreground md:inline"
            >
              {t("docs.backToSite")}
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[100rem] gap-10 px-4 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_14rem]">
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100svh-4rem)] overflow-y-auto py-9 pr-2">
            <DocsSidebar />
          </div>
        </aside>

        <main className="min-w-0 py-9 lg:py-12">
          <div className="mx-auto max-w-3xl">
            <DocsPageHeader />
            <article id="docs-article" className="docs-prose">
              {children}
            </article>
            <DocsPager />
          </div>
        </main>

        <aside className="hidden xl:block">
          <div className="sticky top-16 max-h-[calc(100svh-4rem)] overflow-y-auto py-12">
            <DocsToc />
          </div>
        </aside>
      </div>
    </div>
  )
}
