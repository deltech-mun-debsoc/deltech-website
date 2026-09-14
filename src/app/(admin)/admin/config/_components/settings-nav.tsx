import { SectionNav } from "@/app/(admin)/_components/section-nav"

const SECTIONS = [
  { href: "/admin/config", label: "Event control" },
  { href: "/admin/config/conference", label: "Public identity" },
  { href: "/admin/config/committees", label: "Committees & matrix" },
  { href: "/admin/config/money", label: "Fees & payments" },
  { href: "/admin/config/registration", label: "Closed-page copy" },
]

export function SettingsNav() {
  return <SectionNav sections={SECTIONS} vertical />
}
