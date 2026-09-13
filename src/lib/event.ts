import { cache } from "react"
import { prisma } from "@/lib/prisma"
import type { Event } from "@/generated/prisma/client"

// States an event is no longer being run in. The database carries a partial
// unique index over everything outside this set, so at most one event is active
// at a time and "the current event" is a lookup rather than a choice.
//
// That guarantee is load-bearing: Committee and Delegate are still queried
// globally in most of the app, and those queries stay correct only while one
// event is live. Creating a second active event fails loudly at the database
// rather than quietly blending two events together.
export const INACTIVE_STATES = ["CLOSED", "ARCHIVED"] as const

export const getActiveEvent = cache(async (): Promise<Event | null> => {
  return prisma.event.findFirst({ where: { state: { notIn: [...INACTIVE_STATES] } } })
})

// For the paths that cannot proceed without one: creating a delegate, a
// committee, or anything else that has to belong somewhere. Registration is
// closed when no event is running, so this should already have been refused
// upstream; throwing here is the backstop, not the user-facing message.
export async function requireActiveEvent(): Promise<Event> {
  const event = await getActiveEvent()
  if (!event) throw new Error("No event is running, so there is nothing to register for.")
  return event
}

// Closing an event is a state flip, not a deletion. Its delegates, allotments and
// payments stay exactly where they are, which is what makes a past event
// queryable afterwards: certificates, exports and "who came last year" all need
// the rows to still be there.
//
// It is also what frees the next event's registrations. Identity is per event, so
// a student who attended this one can only register for the next once this one is
// no longer the active one.
export async function closeEvent(id: string): Promise<void> {
  await prisma.event.update({
    where: { id },
    data: { state: "CLOSED", closedAt: new Date() },
  })
}

// A new event starts empty. Committees and portfolios belong to an event, so
// nothing is inherited: last year's matrix does not quietly become this year's.
//
// The database allows only one event outside CLOSED/ARCHIVED, so this closes the
// current one in the same transaction rather than failing halfway and leaving the
// society with two half-open events.
export async function createEvent(input: {
  name: string
  slug: string
  kind?: string
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const running = await tx.event.findFirst({
      where: { state: { notIn: [...INACTIVE_STATES] } },
      select: { id: true },
    })
    if (running) {
      await tx.event.update({
        where: { id: running.id },
        data: { state: "CLOSED", closedAt: new Date() },
      })
    }
    return tx.event.create({
      data: {
        name: input.name,
        slug: input.slug,
        kind: input.kind ?? "CONFERENCE",
        state: "DRAFT",
      },
      select: { id: true },
    })
  })
}

// A where-fragment scoping a list to the event being run now.
//
// Spread into the where clause of anything that LISTS or COUNTS delegates or
// committees. Not for findUnique by id: those take unique fields only, and a row
// fetched by its own id is already unambiguous.
//
// When no event is running this matches nothing rather than everything. That is
// the safe direction: an unscoped list would show a closed event's delegates as
// though they were this year's, and the society's resting state genuinely has no
// delegates to show.
export async function currentEventScope(): Promise<{ eventId: string }> {
  const event = await getActiveEvent()
  return { eventId: event?.id ?? "__no-active-event__" }
}
