import { FileSpreadsheet,
  LayoutDashboard,
  Users,
  Kanban,
  Upload,
  UserPlus,
  FileText,
  Presentation,
  Settings2,
  Contact,
  ScrollText,
  ShieldCheck,
  BookOpenText,
  UserCheck,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  href: string
  icon: LucideIcon
  label: string
  adminOnly?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

// Shared by the desktop sidebar and the mobile drawer.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Run event",
    items: [
      { href: "/admin", icon: LayoutDashboard, label: "Overview" },
      { href: "/admin/config", icon: Settings2, label: "Event control" },
      { href: "/admin/registrations", icon: Users, label: "Registrations" },
      { href: "/admin/form-responses", icon: FileSpreadsheet, label: "Google Form responses" },
      { href: "/admin/checkin", icon: UserCheck, label: "Check-in" },
      { href: "/admin/allotment", icon: Kanban, label: "Allotments" },
      { href: "/admin/config/committees", icon: Contact, label: "Matrix & committees" },
      { href: "/admin/import", icon: Upload, label: "Imports" },
    ],
  },
  {
    label: "Society",
    items: [
      // Control plane only: creating cycles, staffing, monitoring, finalising. The
      // operational GD/PI screens live in the separate /recruitment area so
      // recruitment participants never need dashboard access.
      { href: "/admin/recruitment", icon: UserPlus, label: "Recruitment control" },
      { href: "/admin/blog", icon: FileText, label: "Dispatch" },
      { href: "/admin/quiz", icon: Presentation, label: "Quiz" },
      { href: "/admin/team", icon: Contact, label: "Team" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/guide", icon: BookOpenText, label: "Operator guide" },
      { href: "/admin/logs", icon: ScrollText, label: "Logs" },
      { href: "/admin/participants", icon: Users, label: "Participants" },
      { href: "/admin/users", icon: ShieldCheck, label: "Staff & roles", adminOnly: true },
    ],
  },
]

export function isNavActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === href : pathname.startsWith(href)
}
