"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { longestMatch } from "./admin-nav"

export interface Section {
  href: string
  label: string
}

// Tabs inside one area of the console (Event control, Mailer). Every page in the
// area shows them, so there is always a way back to the others.
export function SectionNav({ sections, vertical = false }: { sections: Section[]; vertical?: boolean }) {
  const active = longestMatch(usePathname(), sections.map((s) => s.href))

  return (
    <nav
      className={cn(
        "flex shrink-0 gap-1 overflow-x-auto overscroll-x-contain",
        vertical ? "lg:w-[var(--admin-rail-width)] lg:flex-col" : "border-b border-border/70",
      )}
    >
      {sections.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={href === active ? "page" : undefined}
          className={cn(
            "min-h-12 whitespace-nowrap border border-transparent px-4 py-3 text-[1.0625rem] leading-snug transition-colors",
            href === active
              ? "border-border bg-accent font-semibold text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
