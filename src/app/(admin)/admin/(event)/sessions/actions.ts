"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { t } from "@/content/strings"
import { getActiveEvent } from "@/lib/event"
import { floorNudge } from "@/lib/committee/floor-server"
import { parseId } from "@/lib/committee/chat"
import { closeSessionRooms, removeFromCommitteeRooms } from "@/lib/livekit/server"
import { participantIdentity } from "@/lib/livekit/video"

// The secretariat's half of an online committee: opening and closing sessions,
// and choosing who chairs. Everything inside a session is the chair's, from
// /chair; nothing here reaches into the floor, chat or video.

const PATH = "/admin/sessions"

// Only an online committee of the running event can be opened or chaired.
async function onlineCommittee(raw: unknown) {
  const id = parseId(raw)
  const event = id ? await getActiveEvent() : null
  if (!id || !event) return null
  return prisma.committee.findFirst({
    where: { id, eventId: event.id, isActive: true, format: { in: ["ONLINE", "HYBRID"] } },
    select: { id: true, name: true },
  })
}

export interface SessionResult {
  success: boolean
  sessionId?: string
  error?: string
}

// ── openSession ───────────────────────────────────────────────────────────────
// Opens a session for a committee and seeds one attendance row per seat, so the
// chair's roll call is a plain query and quorum has a denominator at once.
//
// Race-safe on two axes. `@@unique([committeeId, attempt])` means two chairs
// pressing Open at once cannot create two sessions for the same attempt: the
// loser gets P2002 and adopts the winner's session rather than erroring. The
// seed uses skipDuplicates against `@@unique([sessionId, portfolioId])`, so it
// is idempotent and safe to re-run against a session that already has rows.
export async function openSession(rawCommitteeId: unknown): Promise<SessionResult> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"

  const committee = await onlineCommittee(rawCommitteeId)
  if (!committee) return { success: false, error: t("sessions.errorNotFound") }
  const committeeId = committee.id
  // A session nobody can chair is a room of delegates waiting on nothing.
  if ((await prisma.committeeChair.count({ where: { committeeId } })) === 0) {
    return { success: false, error: t("sessions.noChairs") }
  }

  // An already-live session is adopted rather than replaced: pressing Open twice
  // must not discard marks a chair has already taken.
  const live = await prisma.committeeSession.findFirst({
    where: { committeeId, state: { in: ["NOT_STARTED", "ACTIVE", "PAUSED"] } },
    select: { id: true },
    orderBy: { attempt: "desc" },
  })
  if (live) {
    await seedAttendance(live.id, committeeId)
    revalidatePath(PATH)
    floorNudge(committeeId)
    return { success: true, sessionId: live.id }
  }

  const last = await prisma.committeeSession.findFirst({
    where: { committeeId },
    select: { attempt: true },
    orderBy: { attempt: "desc" },
  })
  const attempt = (last?.attempt ?? 0) + 1
  const now = new Date()

  let sessionId: string
  try {
    const created = await prisma.committeeSession.create({
      data: {
        committeeId,
        attempt,
        state: "ACTIVE",
        controllerId: actorEmail,
        startedAt: now,
        startedById: actorEmail,
        lastActivityAt: now,
      },
      select: { id: true },
    })
    sessionId = created.id
  } catch {
    // Lost the race on [committeeId, attempt]. Adopt whatever the winner made.
    const winner = await prisma.committeeSession.findFirst({
      where: { committeeId, attempt },
      select: { id: true },
    })
    if (!winner) return { success: false, error: "Could not open the session." }
    sessionId = winner.id
  }

  await seedAttendance(sessionId, committeeId)
  await audit(actorEmail, "committee_session_open", "CommitteeSession", sessionId, {
    committee: committee.name,
    attempt,
  })
  revalidatePath(PATH)
  // Chairs and delegates waiting on the session hear it open from this, rather
  // than on their next poll.
  floorNudge(committeeId)
  return { success: true, sessionId }
}

async function seedAttendance(sessionId: string, committeeId: string): Promise<void> {
  const portfolios = await prisma.portfolio.findMany({
    where: { committeeId },
    select: { id: true },
  })
  if (portfolios.length === 0) return
  await prisma.sessionAttendance.createMany({
    data: portfolios.map((p) => ({ sessionId, portfolioId: p.id })),
    skipDuplicates: true,
  })
}

// ── closeSession ──────────────────────────────────────────────────────────────
// Conditional on { id, state, version }: a queued click from a stale tab loses
// rather than reopening or double-closing. Mirrors the recruitment transitions.
export async function closeSession(rawSessionId: unknown, expectedVersion: unknown): Promise<SessionResult> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"
  const sessionId = parseId(rawSessionId)
  if (!sessionId || typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)) {
    return { success: false, error: t("sessions.errorStale") }
  }

  const closing = await prisma.committeeSession.findUnique({ where: { id: sessionId }, select: { committeeId: true } })
  const result = await prisma.committeeSession.updateMany({
    where: { id: sessionId, version: expectedVersion, state: { in: ["ACTIVE", "PAUSED"] } },
    data: {
      state: "COMPLETED",
      version: { increment: 1 },
      endedAt: new Date(),
      endedById: actorEmail,
    },
  })
  if (result.count === 0) {
    return { success: false, error: t("sessions.errorStale") }
  }

  await audit(actorEmail, "committee_session_close", "CommitteeSession", sessionId, {})
  // Tokens outlive the session; ending the rooms is what actually sends people
  // home. Best effort: a down SFU must not stop the session closing.
  await closeSessionRooms(sessionId)
  revalidatePath(PATH)
  if (closing) floorNudge(closing.committeeId)
  return { success: true, sessionId }
}

// ── Chairs ────────────────────────────────────────────────────────────────────
// A chair is usually from outside the secretariat, so a chair gets an account of
// their own with the CHAIR role, which reaches /chair and nothing else. An
// address that already belongs to another kind of account is refused rather
// than converted: turning a delegate or a maintainer into a chair would quietly
// take away everything else that account could do.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function addChair(
  rawCommitteeId: unknown,
  rawEmail: unknown,
): Promise<{ success: boolean; error?: string; warning?: string }> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : ""
  if (!EMAIL.test(email) || email.length > 254) return { success: false, error: t("sessions.errorEmail") }
  const committee = await onlineCommittee(rawCommitteeId)
  if (!committee) return { success: false, error: t("sessions.errorNotFound") }

  let user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } })
  if (user && user.role !== "CHAIR") {
    return { success: false, error: t("sessions.errorNotChairAccount", { role: user.role.toLowerCase().replace("_", " ") }) }
  }
  let created = false
  if (!user) {
    try {
      user = await prisma.user.create({ data: { email, role: "CHAIR" }, select: { id: true, role: true } })
      created = true
    } catch {
      // Lost a race with another add of the same address; use theirs.
      user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } })
      if (user?.role !== "CHAIR") return { success: false, error: t("sessions.errorEmail") }
    }
  }

  await prisma.committeeChair.upsert({
    where: { committeeId_userId: { committeeId: committee.id, userId: user.id } },
    create: { committeeId: committee.id, userId: user.id, assignedById: actorEmail },
    update: {},
  })
  await audit(actorEmail, "committee_chair_add", "Committee", committee.id, { email, created })
  revalidatePath(PATH)
  // A chair already on /chair waiting to be assigned moves on from this.
  floorNudge(committee.id)

  if (!created) return { success: true }
  try {
    const { sendChairInvite } = await import("@/lib/resend")
    await sendChairInvite(email, committee.name)
  } catch {
    return { success: true, warning: t("sessions.inviteFailed", { email }) }
  }
  return { success: true }
}

export async function removeChair(rawCommitteeId: unknown, rawUserId: unknown): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"
  const userId = parseId(rawUserId)
  const committee = await onlineCommittee(rawCommitteeId)
  if (!committee || !userId) return { success: false, error: t("sessions.errorNotFound") }

  const removed = await prisma.committeeChair.deleteMany({ where: { committeeId: committee.id, userId } })
  if (removed.count > 0) {
    await audit(actorEmail, "committee_chair_remove", "Committee", committee.id, { userId })
    // Their tokens are still good for hours. Disconnect them now; the join
    // check refuses them if they try again.
    await removeFromCommitteeRooms(committee.id, participantIdentity({ kind: "dais", userId }))
    floorNudge(committee.id)
  }
  revalidatePath(PATH)
  return { success: true }
}
