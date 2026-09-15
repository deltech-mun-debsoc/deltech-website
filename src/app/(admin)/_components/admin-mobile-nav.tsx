"use client"

import Link from "next/link"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import { SignOutButton } from "@/components/sign-out-button"
import { AccountLink } from "@/components/account-link"
import { NAV_GROUPS, isNavActive } from "./admin-nav"
import type { SidebarUser } from "./admin-sidebar"

// Mobile counterpart of the sidebar, same grouped nav in a vaul drawer.
export function AdminMobileNav({ user }: { user: SidebarUser }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const isAdmin = user.role === "ADMIN"

  return (
    <div className="xl:hidden">
      <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setOpen(true)}>
        <Menu className="size-5" />
      </Button>

      <Drawer open={open} onOpenChange={setOpen} direction="left">
        <DrawerContent className="flex h-full w-[min(17rem,calc(100vw-2rem))] flex-col">
          <DrawerHeader className="border-b border-border/70 text-left">
            <DrawerTitle className="display text-2xl">{t("brand.name")}</DrawerTitle>
            <p className="data-label text-muted-foreground">Secretariat console</p>
          </DrawerHeader>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {NAV_GROUPS.map((group) => {
              const items = group.items.filter((i) => !i.adminOnly || isAdmin)
              if (items.length === 0) return null
              return (
                <div key={group.label ?? "home"} className="mb-5">
                  {group.label && <p className="data-label mb-2 px-3 text-[0.9375rem] text-muted-foreground">{group.label}</p>}
                  {items.map(({ href, icon: Icon, label }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex min-h-12 items-center gap-3 border border-transparent px-3 py-3 text-[1.0625rem] leading-snug transition-colors",
                        isNavActive(pathname, href)
                          ? "border-border bg-accent font-semibold text-accent-foreground"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <Icon className="size-5 shrink-0" />
                      {label}
                    </Link>
                  ))}
                </div>
              )
            })}
          </nav>

          <div className="flex items-center gap-3 border-t border-border/70 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium">{user.name ?? user.email}</p>
              <Badge variant={isAdmin ? "default" : "outline"} className="mt-1 text-[0.6875rem]">
                {user.role}
              </Badge>
            </div>
            <AccountLink compact />
            <SignOutButton compact />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
