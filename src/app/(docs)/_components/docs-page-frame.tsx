"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react"

import { t } from "@/content/strings"
import { neighbours, pageFor, sectionFor } from "../_lib/nav"

/**
 * Titles come from _lib/nav.ts rather than an `# H1` in each page.mdx. One
 * source means the sidebar label, the search result, the breadcrumb and the
 * heading can never disagree, and eighty pages do not each repeat their own
 * title. MDX bodies therefore start at `##`.
 */
export function DocsPageHeader() {
  const pathname = usePathname()
  const page = pageFor(pathname)
  const section = sectionFor(pathname)
  if (!page) return null

  const isRoot = pathname === "/docs"

  return (
    <header className="mb-9">
      <nav aria-label={t("docs.breadcrumbRoot")} className="mb-4">
        <ol className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
          <li>
            <Link href="/docs" className="hover:text-foreground">
              {t("docs.breadcrumbRoot")}
            </Link>
          </li>
          {section && !isRoot ? (
            <>
              <li aria-hidden="true">
                <ChevronRight className="size-3.5" />
              </li>
              <li>{section.label}</li>
            </>
          ) : null}
        </ol>
      </nav>

      <h1 className="display text-[clamp(2rem,4vw,2.75rem)] leading-[1.1] text-foreground">
        {page.label}
      </h1>
      <p className="mt-3 max-w-2xl text-[1.0625rem] leading-relaxed text-muted-foreground">
        {page.summary}
      </p>
      <div className="rule mt-7" />
    </header>
  )
}

export function DocsPager() {
  const pathname = usePathname()
  const { prev, next } = neighbours(pathname)
  if (!prev && !next) return null

  return (
    <nav className="mt-14 grid gap-3 border-t border-border pt-7 sm:grid-cols-2">
      {prev ? (
        <Link
          href={prev.href}
          className="editorial-card group/prev px-4 py-3.5 transition-colors hover:border-primary/50"
        >
          <span className="data-label flex items-center gap-1.5 text-muted-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t("docs.previous")}
          </span>
          <span className="mt-1.5 block font-semibold text-foreground">
            {prev.label}
          </span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {next ? (
        <Link
          href={next.href}
          className="editorial-card group/next px-4 py-3.5 transition-colors hover:border-primary/50 sm:text-right"
        >
          <span className="data-label flex items-center gap-1.5 text-muted-foreground sm:justify-end">
            {t("docs.next")}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </span>
          <span className="mt-1.5 block font-semibold text-foreground">
            {next.label}
          </span>
        </Link>
      ) : null}
    </nav>
  )
}
