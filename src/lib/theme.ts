// Theme preference shared by the public site, admin, and recruitment. The cookie
// gives authenticated server-rendered shells the right first paint; next-themes'
// matching localStorage key applies the same choice to public pages before paint.

export type ThemeChoice = "light" | "dark"
export type ThemePreference = ThemeChoice | "system"
export type ThemeArea = "site" | "admin" | "recruitment"

export const THEME_COOKIE = "theme-preference"
export const THEME_STORAGE_KEY = "theme-site"

// Legacy cookies are read as a one-release migration path. New choices always use
// the single global cookie, so a person never has to set the theme per area.
export const THEME_COOKIES: Record<ThemeArea, string> = {
  site: "theme-site",
  admin: "theme-admin",
  recruitment: "theme-recruitment",
}

export const DEFAULT_THEME: ThemePreference = "system"

export function parseTheme(value: string | null | undefined): ThemePreference {
  return value === "dark" || value === "light" || value === "system" ? value : DEFAULT_THEME
}

// The class an area shell renders. `theme-light` is not merely "no class": it has
// to actively override an inherited `.dark` from the marketing toggle.
export function themeClass(theme: ThemePreference): string {
  return theme === "dark" ? "dark" : theme === "light" ? "theme-light" : ""
}

export function areaForPath(pathname: string): ThemeArea {
  if (pathname.startsWith("/admin")) return "admin"
  if (pathname.startsWith("/recruitment")) return "recruitment"
  return "site"
}

// One year, so a council member's preference survives a whole recruitment season.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
