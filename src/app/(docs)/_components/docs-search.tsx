"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { t } from "@/content/strings"
import { searchPages } from "../_lib/nav"

/**
 * Searches page titles, summaries and per-page keywords from _lib/nav.ts, not
 * body text. Full-text needs either a generated index or a new dependency, and
 * with this many short, well-titled pages the title index answers most queries.
 * If readers start reporting misses, that is the signal to build the index.
 */
export function DocsSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const router = useRouter()
  const results = useMemo(() => searchPages(query), [query])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 text-muted-foreground sm:min-w-56 sm:justify-start"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t("docs.searchOpen")}</span>
        <kbd className="ml-auto hidden rounded border border-border px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground sm:inline">
          {"⌘K"}
        </kbd>
        <span className="sr-only sm:hidden">{t("docs.searchLabel")}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>{t("docs.searchLabel")}</DialogTitle>
            <DialogDescription>{t("docs.searchHint")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("docs.searchPlaceholder")}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) {
                setOpen(false)
                router.push(results[0].href)
              }
            }}
          />
          <div className="max-h-[22rem] overflow-y-auto">
            {query && results.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                {t("docs.searchEmpty")}
              </p>
            ) : null}
            {!query ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                {t("docs.searchHint")}
              </p>
            ) : null}
            <ul>
              {results.map((page) => (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-md px-3 py-2.5 transition-colors hover:bg-muted"
                  >
                    <span className="block text-[0.9375rem] font-semibold">
                      {page.label}
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">
                      {page.summary}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
