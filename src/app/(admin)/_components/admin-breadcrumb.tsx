"use client"

import { usePathname } from "next/navigation"

// Kept in step with the sidebar labels, so the crumb names the page the way the
// sidebar does.
const LABELS: Record<string, string> = {
  registrations: "Registrations",
  "form-responses": "Google Form responses",
  allotment: "Allotments",
  import: "Cross-delegation imports",
  mailer: "Mail",
  outreach: "PR outreach",
  new: "New",
  contacts: "Outreach contacts",
  checkin: "Check-in",
  recruitment: "Recruitment control",
  blog: "Dispatch",
  quiz: "Quiz",
  results: "Results",
  team: "Team",
  logs: "Logs",
  config: "Event control",
  users: "Staff & roles",
  participants: "Participant accounts",
  guide: "Operator guide",
  site: "Website",
  conference: "Public identity",
  committees: "Committees & matrix",
  money: "Fees & payments",
  registration: "Closed-page copy",
}

export function AdminBreadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean).slice(1) // drop "admin"
  const crumbs = ["Admin", ...segments.map((s) => LABELS[s] ?? null).filter((s): s is string => !!s)]

  return (
    <p className="truncate text-[0.9375rem] text-muted-foreground">
      {crumbs.map((c, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5 text-border">/</span>}
          <span className={i === crumbs.length - 1 ? "text-foreground" : undefined}>{c}</span>
        </span>
      ))}
    </p>
  )
}
