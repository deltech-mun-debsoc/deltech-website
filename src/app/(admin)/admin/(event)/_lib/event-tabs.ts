import type { Matchable } from "@/app/(admin)/_components/admin-nav"

type Tab = Matchable & { label: string }

// One workspace for whichever event is running. The main conference and an Intra
// MUN go through the same tabs in the same order; payments, the public matrix and
// who may register are switches in Setup, not separate screens.
export const EVENT_TABS: Tab[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/config", label: "Setup" },
  { href: "/admin/registrations", label: "Delegates", match: ["/admin/form-responses", "/admin/import", "/admin/participants"] },
  { href: "/admin/allotment", label: "Allotment" },
  { href: "/admin/mailer", label: "Mail" },
  { href: "/admin/checkin", label: "Check-in" },
]

// Everything about the event's delegates: the list, and the ways people get onto it.
export const DELEGATE_SECTIONS: Tab[] = [
  { href: "/admin/registrations", label: "All delegates" },
  { href: "/admin/form-responses", label: "Google Form" },
  { href: "/admin/import", label: "Partner sheets" },
  { href: "/admin/participants", label: "Accounts" },
]
