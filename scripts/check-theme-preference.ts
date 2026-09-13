import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { THEME_BOOT_SCRIPT, lastCookieValue, themeCookieDomain } from "../src/lib/theme"

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8")
const theme = read("src/lib/theme.ts")
const providers = read("src/components/providers.tsx")
const admin = read("src/app/(admin)/layout.tsx")
const recruitment = read("src/app/(recruitment)/layout.tsx")
const publicToggle = read("src/app/(marketing)/_components/theme-toggle.tsx")
const areaToggle = read("src/components/theme/area-theme-toggle.tsx")

function requireText(source: string, expected: string, message: string) {
  if (!source.includes(expected)) throw new Error(message)
}

requireText(theme, 'DEFAULT_THEME: ThemePreference = "system"', "theme must default to the OS")
requireText(providers, 'defaultTheme="system"', "provider must default to the OS")
requireText(providers, "enableSystem", "provider must resolve the OS preference")
requireText(admin, "cookieStore.get(THEME_COOKIE)", "admin must read the shared preference")
requireText(recruitment, "cookieStore.get(THEME_COOKIE)", "recruitment must read the shared preference")
requireText(publicToggle, "persistThemePreference(next)", "public toggle must persist globally")
requireText(areaToggle, "persistThemePreference(next)", "authenticated toggles must persist globally")

// One choice across www, docs and test: the cookie must be scoped to the apex,
// never to a lookalike, and never set on localhost.
assert.equal(themeCookieDomain("www.deltechmun.in"), "deltechmun.in")
assert.equal(themeCookieDomain("docs.deltechmun.in"), "deltechmun.in")
assert.equal(themeCookieDomain("deltechmun.in"), "deltechmun.in")
assert.equal(themeCookieDomain("localhost"), "")
assert.equal(themeCookieDomain("evildeltechmun.in"), "")
assert.equal(themeCookieDomain("deltechmun.in.example.com"), "")

// A host-only copy and a shared copy can coexist during migration; the newer wins.
assert.equal(lastCookieValue("a=1; theme-preference=light; theme-preference=dark", "theme-preference"), "dark")
assert.equal(lastCookieValue("a=1", "theme-preference"), undefined)

// The <head> script, run against a fake document and storage.
function boot(cookie: string, stored: string | null) {
  const store = new Map<string, string>()
  if (stored !== null) store.set("theme-site", stored)
  new Function("document", "localStorage", THEME_BOOT_SCRIPT)(
    { cookie },
    { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
  )
  return store.get("theme-site") ?? null
}
assert.equal(boot("theme-preference=dark", "light"), "dark", "a choice from another subdomain must win")
assert.equal(boot("x=1; theme-preference=system", null), "system")
assert.equal(boot("theme-preference=light; theme-preference=dark", null), "dark", "the newest copy must win")
assert.equal(boot("theme-preference=purple", "light"), "light", "junk must not overwrite a real choice")
assert.equal(boot("", null), null, "no cookie, no write")

const layout = read("src/app/layout.tsx")
const sync = read("src/components/theme/theme-preference-sync.tsx")
requireText(layout, "THEME_BOOT_SCRIPT", "root layout must apply the shared choice before paint")
requireText(sync, "Domain=${domain}", "the preference cookie must be shared across subdomains")

console.log("theme preference checks passed (system default, one choice shared across subdomains)")
