import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { t } from "@/content/strings"
import { tally } from "@/lib/committee/roll-call"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { SessionsClient, type SessionRow } from "./_components/sessions-client"

// Sessions only exist where a committee meets online. An in-person committee
// takes attendance at the door (admin/checkin), not here.
const ONLINE_FORMATS = ["ONLINE", "HYBRID"] as const

export default async function SessionsPage() {
  const scope = await currentEventScope()

  const committees = await prisma.committee.findMany({
    where: { ...scope, isActive: true, format: { in: [...ONLINE_FORMATS] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      chairs: {
        orderBy: { createdAt: "asc" },
        select: { user: { select: { id: true, email: true, name: true } } },
      },
      sessions: {
        where: { state: "ACTIVE" },
        orderBy: { attempt: "desc" },
        take: 1,
        select: { id: true, version: true, startedAt: true, attendance: { select: { status: true } } },
      },
    },
  })

  const rows: SessionRow[] = committees.map((c) => {
    const live = c.sessions[0]
    const counts = live ? tally(live.attendance.map((a) => a.status)) : null
    return {
      id: c.id,
      name: c.name,
      chairs: c.chairs.map((ch) => ({ userId: ch.user.id, email: ch.user.email, name: ch.user.name })),
      session: live
        ? {
            id: live.id,
            version: live.version,
            startedAt: live.startedAt?.toISOString() ?? null,
            inRoom: counts!.inRoom,
            total: counts!.total,
          }
        : null,
    }
  })

  return (
    <div className="space-y-8">
      <PageHeader title={t("sessions.title")} description={t("sessions.description")} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sessions.noCommittees")}</p>
      ) : (
        <SessionsClient committees={rows} />
      )}
    </div>
  )
}
