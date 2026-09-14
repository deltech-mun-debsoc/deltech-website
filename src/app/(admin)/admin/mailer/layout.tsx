import { SectionNav } from "@/app/(admin)/_components/section-nav"

const SECTIONS = [
  { href: "/admin/mailer", label: "All mail" },
  { href: "/admin/mailer/new", label: "New mail" },
  { href: "/admin/mailer/contacts", label: "Outreach contacts" },
]

export default function MailerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <SectionNav sections={SECTIONS} />
      {children}
    </div>
  )
}
