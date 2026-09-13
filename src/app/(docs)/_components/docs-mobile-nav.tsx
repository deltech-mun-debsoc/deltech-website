"use client"

import { Menu } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { t } from "@/content/strings"
import { DocsSidebar } from "./docs-sidebar"

export function DocsMobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t("docs.menuOpen")}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-4" aria-hidden="true" />
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        {/* data-[state=closed]:hidden is not belt-and-braces. Tapping a nav link
            closes the drawer and navigates in the same tick, and the client-side
            navigation interrupts vaul's exit transition: the element is left
            marked closed and aria-hidden but still painted over the page. This
            makes "closed" mean invisible regardless of what the animation did. */}
        <DrawerContent className="max-h-[85svh] data-[state=closed]:hidden">
          <DrawerHeader>
            <DrawerTitle>{t("docs.menuTitle")}</DrawerTitle>
            <DrawerDescription>{t("docs.tagline")}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            <DocsSidebar onNavigate={() => setOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
