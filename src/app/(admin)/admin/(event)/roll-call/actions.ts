"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { floorNudge } from "@/lib/committee/floor-server"
import type { CommitteeAttendance } from "@/generated/prisma/client"

const PATH = "/admin/roll-call"

export interface SessionResult {
  success: boolean
  sessionId?: string
  error?: string
}

// ── openSession ───────────────────────────────────────────────────────────────
// Opens roll call for a committee and seeds one attendance row per seat, so the
// screen is a plain query and quorum has a denominator from the first render.
//
// Race-safe on two axes. `@@unique([committeeId, attempt])` means two chairs
// pressing Open at once cannot create two sessions for the same attempt: the
// loser gets P2002 and adopts the winner's session rather than erroring. The
// seed uses skipDuplicates against `@@unique([sessionId, portfolioId])`, so it
// is idempotent and safe to re-run against a session that already has rows.
export async function openSession(committeeId: string): Promise<SessionResult> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"

  const committee = await prisma.committee.findUnique({
    where: { id: committeeId },
    select: { id: true, name: true },
  })
  if (!committee) return { success: false, error: "Committee not found." }

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
  // Screens opened before roll call show "the floor opens with roll call" and
  // hide video; this tells them the session now exists.
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

// ── markAttendance ────────────────────────────────────────────────────────────
// Last write wins, deliberately: a chair correcting a mis-marked seat must win
// over the earlier mark, and two chairs marking the same seat are agreeing about
// a fact in the room rather than racing for a resource.
export async function markAttendance(
  sessionId: string,
  portfolioId: string,
  status: CommitteeAttendance,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"

  const live = await prisma.committeeSession.findUnique({
    where: { id: sessionId },
    select: { state: true },
  })
  if (!live) return { success: false, error: "Session not found." }
  if (live.state === "COMPLETED" || live.state === "ABORTED") {
    return { success: false, error: "This session is closed." }
  }

  const result = await prisma.sessionAttendance.updateMany({
    where: { sessionId, portfolioId },
    data: { status, markedAt: new Date(), markedById: actorEmail },
  })
  if (result.count === 0) return { success: false, error: "That seat is not in this session." }

  await prisma.committeeSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
  })
  revalidatePath(PATH)
  return { success: true }
}

// ── closeSession ──────────────────────────────────────────────────────────────
// Conditional on { id, state, version }: a queued click from a stale tab loses
// rather than reopening or double-closing. Mirrors the recruitment transitions.
export async function closeSession(
  sessionId: string,
  expectedVersion: number,
): Promise<SessionResult> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"

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
    return { success: false, error: "The session changed since this page loaded. Reload and retry." }
  }

  await audit(actorEmail, "committee_session_close", "CommitteeSession", sessionId, {})
  revalidatePath(PATH)
  if (closing) floorNudge(closing.committeeId)
  return { success: true, sessionId }
}
