import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { t } from "@/content/strings"
import { SECTIONS } from "../_lib/nav"

/** The "choose your path" grid on /docs. Reads the same tree as the sidebar. */
export function RoleCards() {
  const sections = SECTIONS.filter((section) => section.id !== "start")

  return (
    <div className="my-8 grid gap-4 sm:grid-cols-2">
      {sections.map((section) => {
        const Icon = section.icon
        const entry = section.pages[0]
        return (
          <Link
            key={section.id}
            href={entry.href}
            className="not-prose editorial-card group/card flex flex-col p-5 transition-colors hover:border-primary/50"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
              <span className="data-label">{section.audience}</span>
            </span>
            <span className="mt-3 font-heading text-lg font-semibold text-foreground">
              {section.label}
            </span>
            <span className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">
              {section.blurb}
            </span>
            <span className="mt-4 flex items-center gap-1.5 text-[0.875rem] font-semibold text-primary">
              {t("docs.readMore")}
              <ArrowRight
                className="size-3.5 transition-transform group-hover/card:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </Link>
        )
      })}
    </div>
  )
}

/** Section index list, used at the top of each section landing page. */
export function SectionIndex({ sectionId }: { sectionId: string }) {
  const section = SECTIONS.find((s) => s.id === sectionId)
  if (!section) return null

  return (
    <ul className="not-prose my-6 grid gap-2">
      {section.pages.slice(1).map((page) => (
        <li key={page.href}>
          <Link
            href={page.href}
            className="not-prose editorial-card flex flex-col px-4 py-3 transition-colors hover:border-primary/50"
          >
            <span className="font-semibold text-foreground">{page.label}</span>
            <span className="mt-0.5 text-[0.875rem] leading-snug text-muted-foreground">
              {page.summary}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
