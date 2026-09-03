import fs from "node:fs"
import path from "node:path"

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

console.log("theme preference checks passed (system default, one shared persistent choice)")
