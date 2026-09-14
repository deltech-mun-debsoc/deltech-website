import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { prMailEnabled } from "@/lib/mailer/queue"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { Composer } from "@/app/(admin)/admin/(event)/mailer/_components/composer"

export default async function NewOutreachPage() {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const [tagRows, prOn] = await Promise.all([
    prisma.mailContact.findMany({ where: { unsubscribedAt: null }, select: { tags: true } }),
    prMailEnabled(),
  ])
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="PR outreach" title="New outreach" description="Preview updates as you change who it goes to." />
      <Composer audience="CONTACTS" tags={[...new Set(tagRows.flatMap((r) => r.tags))].sort()} prOn={prOn} isAdmin={isAdmin} />
    </div>
  )
}
