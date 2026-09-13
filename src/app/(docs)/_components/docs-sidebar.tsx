"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { SECTIONS } from "../_lib/nav"
import { cn } from "@/lib/utils"

/**
 * The whole tree is rendered at once rather than collapsed to the active
 * section. Eighty-odd short pages is exactly the size where seeing the shape of
 * the documentation is worth more than a shorter scroll, and it means a reader
 * who lands from search can see what surrounds them.
 */
export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="pb-16">
      {SECTIONS.map((section) => {
        const Icon = section.icon
        const active = section.pages.some((p) => p.href === pathname)
        return (
          <div key={section.id} className="mb-7">
            <p
              className={cn(
                "mb-2 flex items-center gap-2",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="data-label">{section.label}</span>
            </p>
            <ul className="border-l border-border">
              {section.pages.map((page) => {
                const current = pathname === page.href
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      onClick={onNavigate}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "-ml-px block border-l py-1.5 pl-4 text-[0.9375rem] leading-snug transition-colors",
                        current
                          ? "border-primary font-semibold text-primary"
                          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                      )}
                    >
                      {page.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
