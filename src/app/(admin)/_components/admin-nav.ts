import { FileSpreadsheet,
  LayoutDashboard,
  LayoutGrid,
  Users,
  UserRound,
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
  Mail,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  href: string
  icon: LucideIcon
  label: string
  adminOnly?: boolean
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

// Shared by the desktop sidebar and the mobile drawer. The event groups follow
// the order an event actually runs in, numbered, so a volunteer reads the
// sidebar top to bottom as the plan: set up, take registrations, allot and tell
// people, then the day itself. The same flow serves the main conference and an
// Intra MUN; whatever an event does not use (payments, say) is switched off in
// Event control rather than hidden here.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ href: "/admin", icon: LayoutDashboard, label: "Overview" }],
  },
  {
    label: "1 · Set up the event",
    items: [
      { href: "/admin/config", icon: Settings2, label: "Event control" },
      { href: "/admin/config/committees", icon: LayoutGrid, label: "Committees & matrix" },
    ],
  },
  {
    label: "2 · Registrations",
    items: [
      { href: "/admin/registrations", icon: Users, label: "Registrations" },
      { href: "/admin/form-responses", icon: FileSpreadsheet, label: "Google Form responses" },
      { href: "/admin/import", icon: Upload, label: "Cross-delegation imports" },
      { href: "/admin/participants", icon: UserRound, label: "Participant accounts" },
    ],
  },
  {
    label: "3 · Allot & notify",
    items: [
      { href: "/admin/allotment", icon: Kanban, label: "Allotments" },
      { href: "/admin/mailer", icon: Mail, label: "Mailer" },
    ],
  },
  {
    label: "4 · Event day",
    items: [{ href: "/admin/checkin", icon: UserCheck, label: "Check-in" }],
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
      { href: "/admin/users", icon: ShieldCheck, label: "Staff & roles", adminOnly: true },
    ],
  },
]

// The deepest href that contains the path wins. Plain prefix matching lit up
// two items at once (Event control and Committees & matrix both match
// /admin/config/committees), so the sidebar claimed you were in two places.
export function longestMatch(pathname: string, hrefs: string[]): string | undefined {
  return hrefs
    .filter((h) => pathname === h || (h !== "/admin" && pathname.startsWith(h + "/")))
    .sort((a, b) => b.length - a.length)[0]
}

const NAV_HREFS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))

export function isNavActive(pathname: string, href: string): boolean {
  return longestMatch(pathname, NAV_HREFS) === href
}
