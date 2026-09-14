import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { Composer } from "../_components/composer"

export default async function NewMailPage() {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const committees = await prisma.committee.findMany({
    where: { isActive: true, ...(await currentEventScope()) },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  })
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Mail" title="New mail" description="Pick a stage or set filters; the preview and count follow." />
      <Composer audience="DELEGATES" committees={committees} isAdmin={isAdmin} />
    </div>
  )
}
