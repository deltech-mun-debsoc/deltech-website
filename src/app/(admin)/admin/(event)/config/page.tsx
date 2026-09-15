import { getContent } from "@/lib/settings"
import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { getActiveEvent } from "@/lib/event"
import { EventSettings } from "./_components/event-settings"
import { EventLifecycle } from "./_components/event-lifecycle"

export default async function EventControlPage() {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const [content, event, pastRows] = await Promise.all([
    getContent(),
    getActiveEvent(),
    prisma.event.findMany({
      where: { state: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 12,
      select: { id: true, name: true, kind: true, closedAt: true, _count: { select: { delegates: true } } },
    }),
  ])
  const past = pastRows.map((e) => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    closedAt: e.closedAt?.toISOString() ?? null,
    delegates: e._count.delegates,
  }))

  if (!event) return <EventLifecycle current={null} past={past} canManage={isAdmin} />

  const [committees, seats] = await Promise.all([
    prisma.committee.count({ where: { eventId: event.id, isActive: true } }),
    prisma.portfolio.count({ where: { committee: { eventId: event.id, isActive: true } } }),
  ])

  return (
    <div className="space-y-12">
      {/* Keyed by the event so the form re-reads its values whenever the event
          changes. Its fields are local state seeded once on mount; without the key,
          starting or closing an event below left the old event's name and switches
          in the form, and saving would write them onto the new event. */}
      <EventSettings
        key={event.id}
        initial={{
          name: event.name,
          kind: event.kind === "INTRA_MUN" ? "INTRA_MUN" : "CONFERENCE",
          published: event.state !== "DRAFT",
          registrationOpen: event.registrationOpen,
          paymentsEnabled: event.paymentsEnabled,
          matrixPublic: event.matrixPublic,
          label: content.activeEventLabel,
          brief: content.landingHero.subtitle,
          dates: content.conferenceDates,
          venue: content.venue,
          ctaLabel: content.landingHero.ctaLabel,
          formUrl: content.registrationFormUrl,
          closedMessage: content.registrationClosedMessage,
        }}
        readiness={{ committees, seats }}
        canManagePayments={isAdmin}
      />
      <EventLifecycle current={{ name: event.name }} past={past} canManage={isAdmin} />
    </div>
  )
}
