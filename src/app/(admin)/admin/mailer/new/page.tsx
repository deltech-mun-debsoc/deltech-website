import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { prMailEnabled } from "@/lib/mailer/queue"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { Composer } from "../_components/composer"

export default async function NewMailPage() {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const [committees, tagRows, prOn] = await Promise.all([
    prisma.committee.findMany({
      where: { isActive: true, ...(await currentEventScope()) },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.mailContact.findMany({ where: { unsubscribedAt: null }, select: { tags: true } }),
    prMailEnabled(),
  ])
  const tags = [...new Set(tagRows.flatMap((r) => r.tags))].sort()
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Mailer" title="New mail" description="Preview updates as you change who it goes to." />
      <Composer committees={committees} tags={tags} prOn={prOn} isAdmin={isAdmin} />
    </div>
  )
}
