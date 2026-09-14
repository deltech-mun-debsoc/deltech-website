import { getContent } from "@/lib/settings"
import { requireStaff } from "@/lib/authz"
import { getActiveEvent } from "@/lib/event"
import { EventControl } from "./_components/event-control"
import { EventLifecycle } from "./_components/event-lifecycle"

export default async function EventControlPage() {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const [content, event] = await Promise.all([getContent(), getActiveEvent()])
  return (
    <div className="space-y-10">
      <EventLifecycle
        current={event ? { name: event.name, state: event.state } : null}
        canManage={isAdmin}
      />
      {/* Keyed by the event so the form re-reads its values whenever the event
          changes. Its fields are local state seeded once on mount; without the key,
          starting or closing an event from the card above left the old event's
          name and switches in the form, and Apply would write them back onto the
          new event. */}
      <EventControl key={event?.id ?? "no-event"} content={content} canManagePayments={isAdmin} />
    </div>
  )
}
