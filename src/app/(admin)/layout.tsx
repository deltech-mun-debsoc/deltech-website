import { cookies } from "next/headers"
import { requireStaff } from "@/lib/authz"
import { cn } from "@/lib/utils"
import { THEME_COOKIE, THEME_COOKIES, parseTheme, themeClass } from "@/lib/theme"
import { AreaThemeToggle } from "@/components/theme/area-theme-toggle"
import { ThemedPortalRoot } from "@/components/theme/themed-portal-root"
import { AdminSidebar, type SidebarUser } from "./_components/admin-sidebar"
import { AdminMobileNav } from "./_components/admin-mobile-nav"
import { AdminBreadcrumb } from "./_components/admin-breadcrumb"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff()
  const user: SidebarUser = {
    name: session.user?.name ?? null,
    email: session.user?.email ?? null,
    role: (session.user as { role?: string }).role ?? "MAINTAINER",
  }
  const isPreview = !!process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"

  // Read the shared choice server-side for a stable first paint. Older per-area
  // cookies are accepted only until the person next uses any theme toggle.
  const cookieStore = await cookies()
  const theme = parseTheme(
    cookieStore.get(THEME_COOKIE)?.value ?? cookieStore.get(THEME_COOKIES.admin)?.value,
  )

  return (
    <div className={cn("admin-shell flex", themeClass(theme))}>
      <AdminSidebar user={user} />
      
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <AdminMobileNav user={user} />
            <AdminBreadcrumb />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {isPreview && (
              <span className="rounded-sm border border-gold-500/50 bg-accent px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-accent-foreground">
                Preview
              </span>
            )}
            {user.email && (
              <span className="hidden text-sm text-muted-foreground sm:block">{user.email}</span>
            )}
            <AreaThemeToggle area="admin" initial={theme} />
          </div>
        </header>

        {/* Page content */}
        <main className="min-h-0 flex-1 overflow-auto overscroll-contain bg-background p-5 sm:p-7 lg:p-10">{children}</main>
      </div>

      <ThemedPortalRoot />
    </div>
  )
}
