"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, lastCookieValue, parseTheme, themeCookieDomain } from "@/lib/theme"

export function persistThemePreference(theme: string): void {
  const domain = themeCookieDomain(window.location.hostname)
  if (domain) {
    // Clear the old host-only copy first. Left in place it shadows the shared
    // one for server-rendered shells, which read the first cookie of a name.
    document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  }
  document.cookie = `${THEME_COOKIE}=${parseTheme(theme)}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`
}

// This also migrates an existing `theme-site` localStorage choice into the shared
// cookie on the person's next visit.
export function ThemePreferenceSync() {
  const { theme } = useTheme()

  // Once per load, re-issue the current choice on the shared domain. This moves a
  // preference saved before the docs subdomain existed (host-only) to where
  // every subdomain can read it.
  useEffect(() => {
    const current = lastCookieValue(document.cookie, THEME_COOKIE)
    if (current && themeCookieDomain(window.location.hostname)) persistThemePreference(current)
  }, [])

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
