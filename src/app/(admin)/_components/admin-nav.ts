import {
  CalendarDays,
  Megaphone,
  UserPlus,
  FileText,
  Presentation,
  Contact,
  ScrollText,
  ShieldCheck,
  BookOpenText,
  Globe,
  type LucideIcon,
} from "lucide-react"

export interface Matchable {
  href: string
  // Other paths that belong to this item, e.g. every page of the event workspace.
  match?: string[]
}

export interface NavItem extends Matchable {
  icon: LucideIcon
  label: string
  adminOnly?: boolean
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

// Every page of the event workspace. They live under src/app/(admin)/admin/(event)
// and share one tab bar there, so the sidebar needs only one entry for all of them.
export const EVENT_PATHS = [
  "/admin/config",
  "/admin/registrations",
  "/admin/form-responses",
  "/admin/import",
  "/admin/participants",
  "/admin/allotment",
  "/admin/mailer",
  "/admin/checkin",
  "/admin/sessions",
]

// Shared by the desktop sidebar and the mobile drawer. The event is one place,
// run the same way for the main conference and an Intra MUN; what differs
// between them is switched in Setup, not spread across the sidebar.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ href: "/admin", icon: CalendarDays, label: "Event", match: EVENT_PATHS }],
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
      { href: "/admin/outreach", icon: Megaphone, label: "PR outreach" },
      { href: "/admin/team", icon: Contact, label: "Team" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/guide", icon: BookOpenText, label: "Operator guide" },
      { href: "/admin/logs", icon: ScrollText, label: "Logs" },
      { href: "/admin/site", icon: Globe, label: "Website" },
      { href: "/admin/users", icon: ShieldCheck, label: "Staff & roles", adminOnly: true },
    ],
  },
]

// The item owning the deepest path that contains the current one. Plain prefix
// matching lit up two items at once (Event control and Committees & matrix both
// match /admin/config/committees). "/admin" only ever matches itself, or it
// would contain every page.
export function activeHref(pathname: string, items: Matchable[]): string | undefined {
  let best: { href: string; length: number } | undefined
  for (const item of items) {
    for (const path of [item.href, ...(item.match ?? [])]) {
      const hit = pathname === path || (path !== "/admin" && pathname.startsWith(path + "/"))
      if (hit && (!best || path.length > best.length)) best = { href: item.href, length: path.length }
    }
  }
  return best?.href
}

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items)

export function isNavActive(pathname: string, href: string): boolean {
  return activeHref(pathname, NAV_ITEMS) === href
}
