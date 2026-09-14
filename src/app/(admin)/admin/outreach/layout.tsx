import { SectionNav } from "@/app/(admin)/_components/section-nav"

// PR to people who asked to hear about the society's events. Separate from event
// mail on purpose: it goes to an opt-in list, not to an event's delegates.
const SECTIONS = [
  { href: "/admin/outreach", label: "All outreach" },
  { href: "/admin/outreach/new", label: "New outreach" },
  { href: "/admin/outreach/contacts", label: "Contacts" },
]

export default function OutreachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <SectionNav sections={SECTIONS} />
      {children}
    </div>
  )
}
