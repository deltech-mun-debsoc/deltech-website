import { SectionNav } from "@/app/(admin)/_components/section-nav"

// Only the running event's settings. The society's own copy and page switches
// are on the Website page.
const SECTIONS = [
  { href: "/admin/config", label: "Event control" },
  { href: "/admin/config/committees", label: "Committees & matrix" },
  { href: "/admin/config/money", label: "Fees & payments" },
]

export function SettingsNav() {
  return <SectionNav sections={SECTIONS} vertical />
}
