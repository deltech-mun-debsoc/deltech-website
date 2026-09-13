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
      <EventControl content={content} canManagePayments={isAdmin} />
    </div>
  )
}
