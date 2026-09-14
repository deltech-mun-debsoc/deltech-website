// What the running event decides about the whole site, as one pure function so
// scripts/check-event-state.ts can pin it without a database.
//
// The event's own state drives its public pages. Publishing it shows its homepage
// section, its committees and its registration link; the matrix has its own
// switch. Before this, those four were separate site switches that nothing kept in
// step with the event, so an event could read "Registration open" in admin while
// the website showed nothing at all. The society's own pages (Dispatch, team, quiz,
// recruitment) stay as switches, set on the Website page.

type EventLike = {
  name: string
  kind: string
  state: string
  registrationOpen: boolean
  paymentsEnabled: boolean
  matrixPublic: boolean
}

const KNOWN_KINDS = new Set(["CONFERENCE", "INTRA_MUN"])

export function eventOverlay(event: EventLike | null, storedSections: unknown): Record<string, unknown> {
  const sections = storedSections && typeof storedSections === "object" ? (storedSections as Record<string, unknown>) : {}

  if (!event) {
    // No active event is the society's resting state: nothing open, nothing
    // charged, nothing about an event on show.
    return {
      registrationOpen: false,
      paymentsEnabled: false,
      matrixPublic: false,
      eventMode: "SOCIETY",
      publicSections: { ...sections, activeEvent: false, registration: false, committees: false, matrix: false },
    }
  }

  // A draft is being set up: staff can build it, visitors see none of it, and it
  // takes no registrations whatever its switch says.
  const published = event.state !== "DRAFT"
  return {
    activeEventName: event.name,
    registrationOpen: published && event.registrationOpen,
    paymentsEnabled: event.paymentsEnabled,
    matrixPublic: published && event.matrixPublic,
    // kind is a free-text label, but ContentSchema parses eventMode as a strict
    // enum and getContent() runs on every page: one unrecognised kind would throw
    // there and take the whole site down. An unknown label is simply a conference.
    eventMode: KNOWN_KINDS.has(event.kind) ? event.kind : "CONFERENCE",
    publicSections: {
      ...sections,
      activeEvent: published,
      registration: published,
      committees: published,
      matrix: published && event.matrixPublic,
    },
  }
}
