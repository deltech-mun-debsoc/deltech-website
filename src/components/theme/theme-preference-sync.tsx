"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, parseTheme } from "@/lib/theme"

export function persistThemePreference(theme: string): void {
  document.cookie = `${THEME_COOKIE}=${parseTheme(theme)}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`
}

// This also migrates an existing `theme-site` localStorage choice into the shared
// cookie on the person's next visit.
export function ThemePreferenceSync() {
  const { theme } = useTheme()

  useEffect(() => {
    if (!theme) return

    const cookieNames = document.cookie
      .split(";")
      .map((part) => part.trim().split("=")[0])

    // Do not let a legacy public-site value silently overwrite a legacy admin or
    // recruitment choice. The next explicit toggle establishes the shared value.
    if (
      !cookieNames.includes(THEME_COOKIE) &&
      !cookieNames.includes("theme-admin") &&
      !cookieNames.includes("theme-recruitment")
    ) {
      persistThemePreference(theme)
    }
  }, [theme])

  return null
}
