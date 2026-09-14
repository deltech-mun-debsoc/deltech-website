import { getActiveEvent } from "@/lib/event"
import { Badge } from "@/components/ui/badge"
import { SectionNav } from "@/app/(admin)/_components/section-nav"
import { EVENT_TABS } from "./_lib/event-tabs"

const STATE_LABEL: Record<string, string> = {
  DRAFT: "Being set up",
  OPEN: "Registration open",
  ALLOTMENT: "Allotting",
  LIVE: "Live",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
}

export default async function EventLayout({ children }: { children: React.ReactNode }) {
  const event = await getActiveEvent()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="eyebrow">Event</p>
        {event ? (
          <>
            <span className="font-heading text-xl">{event.name}</span>
            <Badge variant="outline">{STATE_LABEL[event.state] ?? event.state}</Badge>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">No event is running. Start one in Setup.</span>
        )}
      </div>
      <SectionNav sections={EVENT_TABS} />
      {children}
    </div>
  )
}
