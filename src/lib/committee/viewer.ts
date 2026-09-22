import { auth } from "@/lib/auth"
import { STAFF_ROLES } from "@/lib/authz"
import { getActiveEvent } from "@/lib/event"
import { prisma } from "@/lib/prisma"
import type { ChatViewer } from "./chat"

// Who is looking at a committee, decided on the server from the session alone.
//
// A delegate is not linked to a user account by a key: the only join is the
// email address. That is safe only if nobody can hold a session for an address
// they have not proved they own, so this checks `emailVerified` on the user row
// itself rather than trusting that sign-in already did. Sign-in on staging did
// not, at the time this was written: password sign-up accepted any unclaimed
// address. The check here keeps committee chat closed to that whatever the sign-in
// code does.

// Roll call and chat exist only where the committee meets online.
const ONLINE_FORMATS = ["ONLINE", "HYBRID"] as const

export interface CommitteeSeat {
  committeeId: string
  portfolioId: string
  portfolioName: string
}

/**
 * Whether an account may reach committees at all. Pure, so
 * scripts/check-committee-chat.ts pins it. Staff reach committees by role, not by
 * an address match, so verification is the delegate path's concern.
 */
export function mayEnterCommittees(u: {
  staff: boolean
  emailVerified: Date | null
  disabledAt: Date | null
}): boolean {
  if (u.disabledAt) return false
  return u.staff || u.emailVerified !== null
}

interface Identity {
  userId: string
  email: string
  staff: boolean
}

async function identity(): Promise<Identity | null> {
  const session = await auth()
  const userId = (session?.user as { id?: string } | undefined)?.id
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!userId || !role) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true, disabledAt: true },
  })
  if (!user?.email) return null
  const staff = STAFF_ROLES.has(role)
  if (!mayEnterCommittees({ staff, emailVerified: user.emailVerified, disabledAt: user.disabledAt })) return null
  return { userId, email: user.email.trim().toLowerCase(), staff }
}

/**
 * The online-committee seats this delegate holds in the running event: through
 * their own delegate row, or as the co-delegate of a double delegation.
 */
async function seatsFor(email: string): Promise<CommitteeSeat[]> {
  const event = await getActiveEvent()
  if (!event) return []
  const match = { equals: email, mode: "insensitive" as const }
  const allotments = await prisma.allotment.findMany({
    where: {
      delegate: {
        eventId: event.id,
        status: { not: "CANCELLED" },
        OR: [{ email: match }, { coDelegate: { email: match } }],
      },
      committee: { eventId: event.id, isActive: true, format: { in: [...ONLINE_FORMATS] } },
    },
    select: { committeeId: true, portfolioId: true, portfolio: { select: { name: true } } },
  })
  return allotments.map((a) => ({
    committeeId: a.committeeId,
    portfolioId: a.portfolioId,
    portfolioName: a.portfolio.name,
  }))
}

/** Committee ids this session may subscribe to, for the realtime route. */
export async function committeeAccess(): Promise<{ staff: boolean; committeeIds: Set<string> }> {
  const who = await identity()
  if (!who) return { staff: false, committeeIds: new Set() }
  if (who.staff) return { staff: true, committeeIds: new Set() }
  return { staff: false, committeeIds: new Set((await seatsFor(who.email)).map((s) => s.committeeId)) }
}

/** The delegate's seats, for pages that list the committees they can enter. */
export async function mySeats(): Promise<CommitteeSeat[]> {
  const who = await identity()
  if (!who || who.staff) return []
  return seatsFor(who.email)
}

/**
 * The viewer of one committee, or null if this session has no business there.
 * Staff are the dais of every online committee in the running event.
 */
export async function resolveCommitteeViewer(committeeId: string): Promise<ChatViewer | null> {
  const who = await identity()
  if (!who) return null

  if (who.staff) {
    const event = await getActiveEvent()
    if (!event) return null
    const committee = await prisma.committee.findFirst({
      where: { id: committeeId, eventId: event.id, isActive: true, format: { in: [...ONLINE_FORMATS] } },
      select: { id: true },
    })
    return committee ? { kind: "dais", userId: who.userId, email: who.email } : null
  }

  const seat = (await seatsFor(who.email)).find((s) => s.committeeId === committeeId)
  if (!seat) return null
  return {
    kind: "delegate",
    userId: who.userId,
    email: who.email,
    portfolioId: seat.portfolioId,
    portfolioName: seat.portfolioName,
  }
}
