import { auth } from "@/lib/auth"
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
 * scripts/check-committee-viewer.ts pins it. A chair reaches a committee through
 * a CommitteeChair row keyed on their user id, not an address match, so
 * verification is the delegate path's concern.
 */
export function mayEnterCommittees(u: {
  chair: boolean
  emailVerified: Date | null
  disabledAt: Date | null
}): boolean {
  if (u.disabledAt) return false
  return u.chair || u.emailVerified !== null
}

interface Identity {
  userId: string
  email: string
  // The secretariat is not the dais: staff open and close sessions from /admin
  // and see nothing inside a committee. Only a CHAIR account on a committee's
  // CommitteeChair list sits on its dais.
  chair: boolean
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
  const chair = role === "CHAIR"
  if (!mayEnterCommittees({ chair, emailVerified: user.emailVerified, disabledAt: user.disabledAt })) return null
  return { userId, email: user.email.trim().toLowerCase(), chair }
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

export interface ChairedCommittee {
  id: string
  name: string
  holdDirectMessages: boolean
}

/** The online committees in the running event this chair is assigned to. */
async function chairedBy(userId: string): Promise<ChairedCommittee[]> {
  const event = await getActiveEvent()
  if (!event) return []
  return prisma.committee.findMany({
    where: {
      eventId: event.id,
      isActive: true,
      format: { in: [...ONLINE_FORMATS] },
      chairs: { some: { userId } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, holdDirectMessages: true },
  })
}

/** Committee ids this session may subscribe to, for the realtime route. */
export async function committeeAccess(): Promise<{ staff: boolean; committeeIds: Set<string> }> {
  const who = await identity()
  if (!who) return { staff: false, committeeIds: new Set() }
  const ids = who.chair
    ? (await chairedBy(who.userId)).map((c) => c.id)
    : (await seatsFor(who.email)).map((s) => s.committeeId)
  return { staff: false, committeeIds: new Set(ids) }
}

/** The delegate's seats, for pages that list the committees they can enter. */
export async function mySeats(): Promise<CommitteeSeat[]> {
  const who = await identity()
  if (!who || who.chair) return []
  return seatsFor(who.email)
}

/** The committees this chair runs; empty for anyone who is not a chair. */
export async function myChairedCommittees(): Promise<ChairedCommittee[]> {
  const who = await identity()
  if (!who?.chair) return []
  return chairedBy(who.userId)
}

/**
 * The viewer of one committee, or null if this session has no business there.
 * The dais is the committee's assigned chairs, and nobody else.
 */
export async function resolveCommitteeViewer(committeeId: string): Promise<ChatViewer | null> {
  const who = await identity()
  if (!who) return null

  if (who.chair) {
    const chaired = (await chairedBy(who.userId)).some((c) => c.id === committeeId)
    return chaired ? { kind: "dais", userId: who.userId, email: who.email } : null
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
