"use client"

import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useState } from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/content/strings"
import type { ThemeArea, ThemePreference } from "@/lib/theme"
import { persistThemePreference } from "./theme-preference-sync"

export function AreaThemeToggle({ area, initial }: { area: ThemeArea; initial: ThemePreference }) {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const [optimisticTheme, setOptimisticTheme] = useState<"light" | "dark" | null>(null)
  const displayedTheme = optimisticTheme ?? (initial === "system" ? resolvedTheme : initial)
  const next = displayedTheme === "dark" ? "light" : "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t(next === "dark" ? "common.themeDark" : "common.themeLight")}
      onClick={() => {
        setOptimisticTheme(next)
        persistThemePreference(next)
        setTheme(next)

        // Make the authenticated shell react immediately; the refresh then makes
        // its server-rendered class agree with the persisted cookie.
        const shell = document.querySelector(`.${area}-shell`)
        shell?.classList.toggle("dark", next === "dark")
        shell?.classList.toggle("theme-light", next === "light")
        router.refresh()
      }}
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
