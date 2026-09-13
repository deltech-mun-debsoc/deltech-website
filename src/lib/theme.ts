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

// The apex every public host shares. A cookie scoped here is visible to
// www.deltechmun.in, docs.deltechmun.in and test.deltechmun.in alike, so one
// choice follows the person across subdomains. localStorage cannot do that: it
// is per origin, which is why a choice made on docs used to stay on docs.
export const THEME_COOKIE_DOMAIN = "deltechmun.in"

/** The cookie Domain for this host, or "" off our domain (localhost). */
export function themeCookieDomain(hostname: string): string {
  return hostname === THEME_COOKIE_DOMAIN || hostname.endsWith(`.${THEME_COOKIE_DOMAIN}`)
    ? THEME_COOKIE_DOMAIN
    : ""
}

/**
 * The newest value when a name appears twice, as a host-only copy and a shared
 * copy do during migration. Browsers list same-path cookies oldest first.
 */
export function lastCookieValue(cookieHeader: string, name: string): string | undefined {
  let value: string | undefined
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) value = rest.join("=")
  }
  return value
}

// Inlined into <head> by the root layout. It runs before next-themes reads
// localStorage, so a choice made on another subdomain is applied before first
// paint instead of flashing the wrong theme and then correcting itself.
export const THEME_BOOT_SCRIPT = `(function(){try{var v,p=document.cookie.split(";");for(var i=0;i<p.length;i++){var k=p[i].trim().split("=");if(k[0]==="${THEME_COOKIE}")v=k[1]}if(v==="light"||v==="dark"||v==="system"){if(localStorage.getItem("${THEME_STORAGE_KEY}")!==v)localStorage.setItem("${THEME_STORAGE_KEY}",v)}}catch(e){}})()`
