import Link from "next/link"
import { requireStaff } from "@/lib/authz"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { buttonVariants } from "@/components/ui/button"
import { CampaignList } from "@/app/(admin)/admin/(event)/mailer/_components/campaign-list"

export default async function OutreachPage() {
  await requireStaff()
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Society" title="PR outreach" description="Announcements to the opt-in outreach list, every few days while registration is open.">
        <Link href="/admin/outreach/new" className={buttonVariants()}>New outreach</Link>
      </PageHeader>
      <CampaignList audience="CONTACTS" />
    </div>
  )
}
