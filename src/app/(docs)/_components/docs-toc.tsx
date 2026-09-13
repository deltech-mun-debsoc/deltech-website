"use client"

import { useEffect, useState } from "react"

import { t } from "@/content/strings"
import { cn } from "@/lib/utils"

interface Heading {
  id: string
  text: string
  level: number
}

/**
 * Headings are read from the DOM instead of extracted at build time. rehype-slug
 * has already stamped an id on every one, so a query selector gets the same
 * answer a build-time walk would, without a second markdown parse in the
 * toolchain or a per-page export the MDX author has to remember to write.
 */
export function DocsToc() {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string>("")

  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLHeadingElement>("#docs-article h2, #docs-article h3"),
    ).filter((node) => node.id)

    setHeadings(
      nodes.map((node) => ({
        id: node.id,
        text: node.textContent ?? "",
        level: node.tagName === "H2" ? 2 : 3,
      })),
    )

    if (nodes.length === 0) return

    // An IntersectionObserver was the first attempt and it is wrong here: it can
    // only report headings currently inside its band, and between two widely
    // spaced headings no heading is in the band at all, so the highlight blanks
    // out. What the reader wants is the last heading they have scrolled past,
    // which is a question about position, not intersection.
    const OFFSET = 96

    function sync() {
      let current = nodes[0].id
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= OFFSET) current = node.id
        else break
      }
      // At the very bottom the last heading may never reach the offset, so the
      // final section would be unreachable on a short page.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
        current = nodes[nodes.length - 1].id
      }
      setActiveId(current)
    }

    let queued = false
    function onScroll() {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        sync()
      })
    }

    sync()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])

  if (headings.length < 2) return null

  return (
    <nav aria-labelledby="docs-toc-heading">
      <p id="docs-toc-heading" className="data-label mb-3 text-muted-foreground">
        {t("docs.onThisPage")}
      </p>
      <ul className="space-y-1.5 border-l border-border">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={cn(
                "-ml-px block border-l py-0.5 text-[0.875rem] leading-snug transition-colors",
                heading.level === 3 ? "pl-7" : "pl-4",
                activeId === heading.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
