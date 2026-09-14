import Link from "next/link"
import { requireStaff } from "@/lib/authz"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { buttonVariants } from "@/components/ui/button"
import { CampaignList } from "./_components/campaign-list"

export default async function MailerPage() {
  await requireStaff()
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Event" title="Mail" description="Announcements and reminders to this event's delegates: by stage, by filter, or hand-picked from the delegate list.">
        <Link href="/admin/mailer/new" className={buttonVariants()}>New mail</Link>
      </PageHeader>
      <CampaignList audience="DELEGATES" />
    </div>
  )
}
