import { cookies } from "next/headers"
import { requireRecruitmentAccess } from "@/lib/recruitment/authz"
import { cn } from "@/lib/utils"
import { THEME_COOKIES, parseTheme, themeClass } from "@/lib/theme"
import { AreaThemeToggle } from "@/components/theme/area-theme-toggle"
import { ThemedPortalRoot } from "@/components/theme/themed-portal-root"
import { SignOutButton } from "@/components/sign-out-button"
import { t, type StringKey } from "@/content/strings"
import { RecruitmentSidebar } from "./_components/recruitment-sidebar"
import { RecruitmentMobileNav } from "./_components/recruitment-mobile-nav"

// The authoritative recruitment gate. The proxy only checks that the caller is
// signed in (the edge cannot query RecruitmentMember); this layout resolves their
// real per-cycle role and sends anyone without one back to their own home.
//
// Note what is NOT here: no requireStaff, no admin sidebar, no dashboard links. A
// SUB_MAINTAINER lives entirely inside this shell.
export default async function RecruitmentLayout({ children }: { children: React.ReactNode }) {
  const { actor, cycle, role } = await requireRecruitmentAccess()

  // This area's own theme, rendered server-side. See src/lib/theme.ts.
  const theme = parseTheme((await cookies()).get(THEME_COOKIES.recruitment)?.value)

  // Signed in and assigned somewhere, but nothing is running right now.
  if (!cycle || !role) {
    return (
      <div className={cn("recruitment-shell min-h-svh bg-background", themeClass(theme))}>
        <div className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center px-6 text-center">
          <p className="data-label text-muted-foreground">
            {t("recruitment.brand")}
          </p>
          <h1 className="mt-3 font-heading text-2xl">{t("recruitment.shell.noCycleTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("recruitment.shell.noCycleBody")}</p>
          <div className="mt-6 flex items-center gap-2">
            <AreaThemeToggle area="recruitment" initial={theme} />
            <SignOutButton />
          </div>
        </div>

        <ThemedPortalRoot />
      </div>
    )
  }

  const user = {
    name: actor.name,
    email: actor.email,
    role,
    cycleName: cycle.name,
  }

  return (
    <div className={cn("recruitment-shell flex min-h-svh", themeClass(theme))}>
      <RecruitmentSidebar user={user} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <RecruitmentMobileNav user={user} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{cycle.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t(`recruitment.roles.${role}` as StringKey)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AreaThemeToggle area="recruitment" initial={theme} />
            <SignOutButton />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto bg-background p-5 sm:p-7 lg:p-10">
          {children}
        </main>
      </div>

      <ThemedPortalRoot />
    </div>
  )
}
