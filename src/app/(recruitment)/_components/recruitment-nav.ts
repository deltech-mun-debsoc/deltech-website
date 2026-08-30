import { LayoutDashboard, Users2, UserSquare2, MessagesSquare, FileSpreadsheet, ScrollText, type LucideIcon } from "lucide-react"
import type { RecruitmentRoleName } from "@/lib/recruitment/permissions"
import { can, type RecruitmentAction } from "@/lib/recruitment/permissions"

export interface RecruitmentNavItem {
  href: string
  icon: LucideIcon
  labelKey: string
  // The capability that makes this destination meaningful. Purely to avoid showing
  // a JC a page they would be redirected out of: the pages guard themselves.
  requires?: RecruitmentAction
}

// Deliberately separate from the admin sidebar's NAV_GROUPS: the recruitment area
// must never surface a dashboard destination.
export const RECRUITMENT_NAV: RecruitmentNavItem[] = [
  { href: "/recruitment", icon: LayoutDashboard, labelKey: "recruitment.nav.overview" },
  { href: "/recruitment/gd", icon: MessagesSquare, labelKey: "recruitment.nav.gd" },
  // Interviews are a maintainer surface. A JC helps run the GD they were put on
  // and scores it; they have no business in the interview queue, which lists every
  // candidate past GD by name and email.
  {
    href: "/recruitment/pi",
    icon: UserSquare2,
    labelKey: "recruitment.nav.pi",
    requires: "group.create",
  },
  { href: "/recruitment/candidates", icon: Users2, labelKey: "recruitment.nav.candidates" },
  {
    href: "/recruitment/responses",
    icon: FileSpreadsheet,
    labelKey: "recruitment.nav.responses",
    requires: "import.preview",
  },
  {
    href: "/recruitment/audit",
    icon: ScrollText,
    labelKey: "recruitment.nav.audit",
    requires: "audit.view",
  },
]

export function visibleNav(role: RecruitmentRoleName): RecruitmentNavItem[] {
  return RECRUITMENT_NAV.filter((item) => !item.requires || can(role, item.requires))
}

export function isRecruitmentNavActive(pathname: string, href: string): boolean {
  return href === "/recruitment" ? pathname === href : pathname.startsWith(href)
}
