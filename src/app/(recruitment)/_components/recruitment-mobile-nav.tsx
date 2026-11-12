"use client"

import Link from "next/link"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import { SignOutButton } from "@/components/sign-out-button"
import { isRecruitmentNavActive, visibleNav } from "./recruitment-nav"
import type { RecruitmentShellUser } from "./recruitment-sidebar"

// Mobile counterpart of the recruitment sidebar: same scoped nav in a vaul drawer,
// matching the admin drawer's shape without sharing its item list.
export function RecruitmentMobileNav({ user }: { user: RecruitmentShellUser }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const items = visibleNav(user.role)

  return (
    <div className="lg:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("recruitment.nav.overview")}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>

      <Drawer open={open} onOpenChange={setOpen} direction="left">
        <DrawerContent className="flex h-full w-[min(17rem,calc(100vw-2rem))] flex-col">
          <DrawerHeader className="border-b border-border/70 text-left">
            <DrawerTitle className="text-xl font-semibold">{t("recruitment.brand")}</DrawerTitle>
            {user.cycleName && (
              <p className="data-label text-muted-foreground">{user.cycleName}</p>
            )}
          </DrawerHeader>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            <ul className="space-y-1">
              {items.map((item) => {
                const active = isRecruitmentNavActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
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

          <div className="border-t border-border/70 p-3">
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              {t(`recruitment.roles.${user.role}` as StringKey)}
            </p>
            <SignOutButton />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
