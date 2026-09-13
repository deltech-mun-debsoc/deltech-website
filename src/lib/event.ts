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
