"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import type { RecruitmentRoleName } from "@/lib/recruitment/permissions"
import { isRecruitmentNavActive, visibleNav } from "./recruitment-nav"

export interface RecruitmentShellUser {
  name: string | null
  email: string | null
  role: RecruitmentRoleName
  cycleName: string | null
}

// The recruitment area's own navigation. It deliberately shares nothing with the
// admin sidebar so a Junior Council member is never shown a dashboard destination,
// there is no filtered-down admin nav here to leak one.
export function RecruitmentSidebar({ user }: { user: RecruitmentShellUser }) {
  const pathname = usePathname()
  const items = visibleNav(user.role)

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-card lg:flex">
      <div className="border-b border-border/70 px-5 py-4">
        <p className="data-label text-muted-foreground">
          {t("recruitment.brand")}
        </p>
        {user.cycleName && (
          <p className="mt-1 truncate font-heading text-lg leading-tight">{user.cycleName}</p>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {items.map((item) => {
            const active = isRecruitmentNavActive(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span className="truncate">{t(item.labelKey as StringKey)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-border/70 px-5 py-4">
        <p className="data-label text-muted-foreground">
          {t("recruitment.shell.roleLabel")}
        </p>
        <p className="mt-0.5 text-sm font-medium">
          {t(`recruitment.roles.${user.role}` as StringKey)}
        </p>
        {user.email && (
          <p className="mt-1 truncate text-xs text-muted-foreground">{user.email}</p>
        )}
      </div>
    </aside>
  )
}
