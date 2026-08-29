import { THEME_PORTAL_ID } from "@/lib/theme-portal"

// The mount point popups portal into, rendered inside each themed area shell so
// they inherit that area's theme rather than <html>'s. Deliberately empty and
// unstyled: it must not clip or size anything. See src/lib/theme-portal.ts.
export function ThemedPortalRoot() {
  return <div id={THEME_PORTAL_ID} />
}
