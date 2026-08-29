"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import {
  RecruitmentDenied,
  requireGroupAccess,
  requireRecruitmentAction,
} from "@/lib/recruitment/authz"
import { auditRecruitmentTx, newRequestId } from "@/lib/recruitment/audit"
import {
  accumulatedPauseMs,
  decideAbort,
  decideFinish,
  decidePause,
  decideReopen,
  decideResume,
  decideStart,
  decideTakeControl,
  nextControlExpiry,
  type SessionSnapshot,
  type SessionStateName,
} from "@/lib/recruitment/session"
import {
  nextNaturalStage,
  type CandidateResultName,
  type CandidateStageName,
} from "@/lib/recruitment/transitions"
import { sessionActionSchema } from "@/lib/schemas/recruitment"
import type { Prisma } from "@/generated/prisma/client"

// Session lifecycle. Every mutation here follows the same shape:
//
//   1. guard (role + cycle state + group scoping)
//   2. read the current row inside a transaction
//   3. ask a pure decide*() function what to do
//   4. execute as a CONDITIONAL updateMany on { id, state, version }
//   5. if it matched 0 rows, someone else won: return their state, never retry blindly
//   6. write the audit row in the SAME transaction
//
// That is what makes start/stop idempotent, makes stale UI lose, and makes two
// maintainers racing produce one winner and one honest conflict response.

export type SessionResult =
  | { ok: true; idempotent: boolean; session: SerializedSession }
  | { ok: false; error: string; conflict?: SerializedSession }

export interface SerializedSession {
  id: string
  groupId: string
  kind: "GD" | "PI"
  // Narrow, not `string`: the console feeds this straight into SessionTimer, which
  // must be able to tell ACTIVE from PAUSED to decide whether to tick.
  state: SessionStateName
  version: number
  attempt: number
  controllerId: string | null
  startedAt: string | null
  pausedAt: string | null
  endedAt: string | null
  pausedMs: number
  lastActivityAt: string | null
  plannedSeconds: number | null
  // Sampled server time. The client anchors its ticking display to this and
  // corrects for its own clock skew, so a wrong device clock changes nothing.
  serverNow: string
}

type SessionRow = {
  id: string
  cycleId: string
  groupId: string
  kind: "GD" | "PI"
  state: SessionSnapshot["state"]
  version: number
  attempt: number
  controllerId: string | null
  controlExpiresAt: Date | null
  startedAt: Date | null
  pausedAt: Date | null
  endedAt: Date | null
  pausedMs: number
  lastActivityAt: Date | null
  plannedSeconds: number | null
}

const SESSION_SELECT = {
  id: true,
  cycleId: true,
  groupId: true,
  kind: true,
  state: true,
  version: true,
  attempt: true,
  controllerId: true,
  controlExpiresAt: true,
  startedAt: true,
  pausedAt: true,
  endedAt: true,
  pausedMs: true,
  lastActivityAt: true,
  plannedSeconds: true,
} as const

function toSnapshot(row: SessionRow): SessionSnapshot {
  return {
    id: row.id,
    state: row.state,
    version: row.version,
    controllerId: row.controllerId,
    controlExpiresAt: row.controlExpiresAt,
    startedAt: row.startedAt,
    pausedAt: row.pausedAt,
    endedAt: row.endedAt,
    pausedMs: row.pausedMs,
    lastActivityAt: row.lastActivityAt,
  }
}

function serialize(row: SessionRow, serverNow: Date): SerializedSession {
  return {
    id: row.id,
    groupId: row.groupId,
    kind: row.kind,
    state: row.state,
    version: row.version,
    attempt: row.attempt,
    controllerId: row.controllerId,
    startedAt: row.startedAt?.toISOString() ?? null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    pausedMs: row.pausedMs,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    plannedSeconds: row.plannedSeconds,
    serverNow: serverNow.toISOString(),
  }
}

function denied(err: unknown): SessionResult {
  if (err instanceof RecruitmentDenied) {
    return {
      ok: false,
      error:
        err.detail === "cycle-state"
          ? "This recruitment cycle's current state does not allow that."
          : "You do not have permission to do that.",
    }
  }
  console.error("[recruitment/session]", err)
  return { ok: false, error: "Something went wrong. Reload and try again." }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function startSession(input: {
  sessionId: string
  expectedVersion?: number
}): Promise<SessionResult> {
  const parsed = sessionActionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid request." }

  const session = await prisma.recruitmentSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: { groupId: true },
  })
  if (!session) return { ok: false, error: "Session not found." }

  try {
    const { ctx } = await requireGroupAccess(session.groupId, "session.start")
    const requestId = newRequestId()

    return await prisma.$transaction(async (tx) => {
      const serverNow = new Date()
      // SELECT ... FOR UPDATE: two simultaneous starts serialise here rather than
      // both reading NOT_STARTED and both deciding to apply.
      await tx.$queryRaw`SELECT id FROM "RecruitmentSession" WHERE id = ${parsed.data.sessionId} FOR UPDATE`

      const row = (await tx.recruitmentSession.findUnique({
        where: { id: parsed.data.sessionId },
        select: SESSION_SELECT,
      })) as SessionRow | null
      if (!row) return { ok: false as const, error: "Session not found." }

      const decision = decideStart(toSnapshot(row), {
        actorId: ctx.userId,
        expectedVersion: parsed.data.expectedVersion,
        serverNow,
      })

      // Already running: report success without touching the timer. This is the
      // double-click / retry / second-tab path.
      if (decision === "noop") {
        return { ok: true as const, idempotent: true, session: serialize(row, serverNow) }
      }
      if (decision === "conflict") {
        return {
          ok: false as const,
          error: "This session was changed by someone else. The latest state is shown.",
          conflict: serialize(row, serverNow),
        }
      }

      // Lock every candidate in the roster. The PK on RecruitmentCandidateLock is
      // what guarantees a candidate cannot be live in two sessions: a collision
      // aborts this transaction rather than double-booking them.
      const members = await tx.recruitmentGroupMember.findMany({
        where: { groupId: row.groupId, attendance: { not: "REASSIGNED" } },
        select: { candidateId: true },
      })

      try {
        if (members.length > 0) {
          await tx.recruitmentCandidateLock.createMany({
            data: members.map((m) => ({
              candidateId: m.candidateId,
              sessionId: row.id,
              cycleId: row.cycleId,
            })),
          })
        }
      } catch (lockErr) {
        if (isUniqueViolation(lockErr)) {
          const clash = await tx.recruitmentCandidateLock.findFirst({
            where: { candidateId: { in: members.map((m) => m.candidateId) } },
            select: { candidate: { select: { fullName: true } } },
          })
          throw new SessionConflict(
            clash
              ? `${clash.candidate.fullName} is already in another live session. End that one first.`
              : "A candidate in this group is already in another live session.",
          )
        }
        throw lockErr
      }

      const updated = await tx.recruitmentSession.updateMany({
        where: { id: row.id, state: row.state, version: row.version },
        data: {
          state: "ACTIVE",
          startedAt: serverNow,
          lastActivityAt: serverNow,
          controllerId: ctx.userId,
          controlExpiresAt: nextControlExpiry(serverNow),
          startedById: ctx.userId,
          version: { increment: 1 },
        },
      })
      // Lost the race between the lock read and the update.
      if (updated.count === 0) {
        const fresh = (await tx.recruitmentSession.findUnique({
          where: { id: row.id },
          select: SESSION_SELECT,
        })) as SessionRow
        throw new SessionConflict("Another maintainer started this session first.", serialize(fresh, serverNow))
      }

      await tx.recruitmentGroup.update({ where: { id: row.groupId }, data: { state: "RUNNING" } })

      // Candidates enter the active stage for this kind.
      await tx.recruitmentCandidate.updateMany({
        where: {
          id: { in: members.map((m) => m.candidateId) },
          stage: row.kind === "GD" ? "GD_PENDING" : "PI_PENDING",
        },
        data: { stage: row.kind === "GD" ? "GD_ACTIVE" : "PI_ACTIVE" },
      })

      await auditRecruitmentTx(tx, {
        eventType: "session.start",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: row.cycleId,
        sessionId: row.id,
        groupId: row.groupId,
        previousState: { state: row.state, version: row.version },
        newState: { state: "ACTIVE", version: row.version + 1, startedAt: serverNow.toISOString() },
        meta: { kind: row.kind, attempt: row.attempt, candidates: members.length, implicit: ctx.implicit },
        requestId,
      })

      const fresh = (await tx.recruitmentSession.findUnique({
        where: { id: row.id },
        select: SESSION_SELECT,
      })) as SessionRow

      revalidatePath("/recruitment")
      return { ok: true as const, idempotent: false, session: serialize(fresh, serverNow) }
    })
  } catch (err) {
    if (err instanceof SessionConflict) {
      return { ok: false, error: err.message, conflict: err.conflict }
    }
    return denied(err)
  }
}

// ---------------------------------------------------------------------------
// Pause / resume / finish / abort: one shared conditional-update helper
// ---------------------------------------------------------------------------

type Lifecycle = "pause" | "resume" | "finish" | "abort"

const LIFECYCLE_ACTION = {
  pause: "session.pause",
  resume: "session.resume",
  finish: "session.finish",
  abort: "session.abort",
} as const

async function transition(
  kind: Lifecycle,
  input: { sessionId: string; expectedVersion?: number; reason?: string },
): Promise<SessionResult> {
  const parsed = sessionActionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid request." }

  const found = await prisma.recruitmentSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: { groupId: true },
  })
  if (!found) return { ok: false, error: "Session not found." }

  try {
    const { ctx } = await requireGroupAccess(found.groupId, LIFECYCLE_ACTION[kind])
    const requestId = newRequestId()

    return await prisma.$transaction(async (tx) => {
      const serverNow = new Date()
      await tx.$queryRaw`SELECT id FROM "RecruitmentSession" WHERE id = ${parsed.data.sessionId} FOR UPDATE`

      const row = (await tx.recruitmentSession.findUnique({
        where: { id: parsed.data.sessionId },
        select: SESSION_SELECT,
      })) as SessionRow | null
      if (!row) return { ok: false as const, error: "Session not found." }

      const snapshot = toSnapshot(row)
      const decisionInput = {
        actorId: ctx.userId,
        expectedVersion: parsed.data.expectedVersion,
        serverNow,
      }
      const decision =
        kind === "pause"
          ? decidePause(snapshot, decisionInput)
          : kind === "resume"
            ? decideResume(snapshot, decisionInput)
            : kind === "finish"
              ? decideFinish(snapshot, decisionInput)
              : decideAbort(snapshot, decisionInput)

      if (decision === "noop") {
        return { ok: true as const, idempotent: true, session: serialize(row, serverNow) }
      }
      if (decision === "conflict") {
        return {
          ok: false as const,
          error:
            row.controllerId && row.controllerId !== ctx.userId
              ? "Another maintainer currently controls this session."
              : "This session was changed by someone else. The latest state is shown.",
          conflict: serialize(row, serverNow),
        }
      }

      const data: Prisma.RecruitmentSessionUpdateManyMutationInput = {
        lastActivityAt: serverNow,
        version: { increment: 1 },
        controlExpiresAt: nextControlExpiry(serverNow),
      }
      let newState = row.state as string

      if (kind === "pause") {
        data.state = "PAUSED"
        data.pausedAt = serverNow
        newState = "PAUSED"
      } else if (kind === "resume") {
        data.state = "ACTIVE"
        // Fold the closed pause window into the running total, then clear it.
        data.pausedMs = accumulatedPauseMs(snapshot, serverNow)
        data.pausedAt = null
        data.resumedAt = serverNow
        newState = "ACTIVE"
      } else if (kind === "finish") {
        data.state = "COMPLETED"
        data.endedAt = serverNow
        data.pausedMs = accumulatedPauseMs(snapshot, serverNow)
        data.pausedAt = null
        data.endedById = ctx.userId
        newState = "COMPLETED"
      } else {
        data.state = "ABORTED"
        data.endedAt = serverNow
        data.abortedById = ctx.userId
        data.abortReason = parsed.data.reason ?? null
        newState = "ABORTED"
      }

      const updated = await tx.recruitmentSession.updateMany({
        where: { id: row.id, state: row.state, version: row.version },
        data,
      })
      if (updated.count === 0) {
        const fresh = (await tx.recruitmentSession.findUnique({
          where: { id: row.id },
          select: SESSION_SELECT,
        })) as SessionRow
        throw new SessionConflict(
          "Someone else changed this session first. The latest state is shown.",
          serialize(fresh, serverNow),
        )
      }

      // Finishing or aborting releases the candidate locks and moves the roster on.
      if (kind === "finish" || kind === "abort") {
        await tx.recruitmentCandidateLock.deleteMany({ where: { sessionId: row.id } })
        await tx.recruitmentGroup.update({
          where: { id: row.groupId },
          data: { state: kind === "finish" ? "DONE" : "READY" },
        })

        const members = await tx.recruitmentGroupMember.findMany({
          where: { groupId: row.groupId, attendance: { not: "REASSIGNED" } },
          select: { candidateId: true, attendance: true },
        })

        if (kind === "finish") {
          // Present candidates complete the stage. Absentees stay where they were,
          // an absence is not a completed evaluation.
          const present = members.filter((m) => m.attendance !== "ABSENT").map((m) => m.candidateId)
          const activeStage = row.kind === "GD" ? "GD_ACTIVE" : "PI_ACTIVE"
          const completeStage = row.kind === "GD" ? "GD_COMPLETE" : "PI_COMPLETE"

          await tx.recruitmentCandidate.updateMany({
            where: { id: { in: present }, stage: activeStage },
            data: { stage: completeStage },
          })

          // Absentees would otherwise sit at *_ACTIVE forever once the session is
          // COMPLETED: they match neither the assignable queue for this stage nor
          // the next one. Return them to the queue so they can be reseated.
          const absent = members.filter((m) => m.attendance === "ABSENT").map((m) => m.candidateId)
          if (absent.length > 0) {
            await tx.recruitmentCandidate.updateMany({
              where: { id: { in: absent }, stage: activeStage },
              data: { stage: row.kind === "GD" ? "GD_PENDING" : "PI_PENDING" },
            })
          }

          // Completing the stage is not the same as entering the next one, and a
          // candidate parked at GD_COMPLETE appears in no queue at all. Advance
          // them the way moveCandidateStage would, honouring gd/piRequired through
          // nextNaturalStage rather than assuming GD -> PI, and recording the same
          // handoff rows so the move is auditable.
          const advancing = await tx.recruitmentCandidate.findMany({
            where: { id: { in: present }, stage: completeStage },
            select: { id: true, stage: true, result: true, gdRequired: true, piRequired: true, version: true },
          })

          for (const candidate of advancing) {
            // A candidate already decided (held, withdrawn, rejected) stays put:
            // finishing a session must not resurrect them into the next queue.
            if (candidate.result !== "PENDING") continue

            const to = nextNaturalStage({
              stage: candidate.stage as CandidateStageName,
              result: candidate.result as CandidateResultName,
              gdRequired: candidate.gdRequired,
              piRequired: candidate.piRequired,
            })
            // DECISION is a deliberate human call, so auto-advance stops at the
            // last queue and leaves the outcome to an operator.
            if (!to || to === "DECISION") continue

            const moved = await tx.recruitmentCandidate.updateMany({
              where: { id: candidate.id, stage: candidate.stage, version: candidate.version },
              data: { stage: to, version: { increment: 1 } },
            })
            if (moved.count === 0) continue

            await tx.recruitmentHandoff.create({
              data: {
                cycleId: row.cycleId,
                candidateId: candidate.id,
                fromStage: candidate.stage,
                toStage: to,
                reason: `Advanced automatically when the ${row.kind} session finished.`,
                actorId: ctx.userId,
                actorRole: ctx.role,
                sessionId: row.id,
                previousState: { stage: candidate.stage },
                newState: { stage: to },
              },
            })

            await auditRecruitmentTx(tx, {
              eventType: "candidate.transition",
              actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
              cycleId: row.cycleId,
              candidateId: candidate.id,
              sessionId: row.id,
              groupId: row.groupId,
              previousState: { stage: candidate.stage },
              newState: { stage: to },
              reason: `Advanced automatically when the ${row.kind} session finished.`,
              meta: { automatic: true, sessionKind: row.kind },
              requestId,
            })
          }
        } else {
          // An abort returns everyone to the queue so the group can be re-run.
          await tx.recruitmentCandidate.updateMany({
            where: {
              id: { in: members.map((m) => m.candidateId) },
              stage: row.kind === "GD" ? "GD_ACTIVE" : "PI_ACTIVE",
            },
            data: { stage: row.kind === "GD" ? "GD_PENDING" : "PI_PENDING" },
          })
        }
      }

      await auditRecruitmentTx(tx, {
        eventType: `session.${kind}`,
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: row.cycleId,
        sessionId: row.id,
        groupId: row.groupId,
        previousState: { state: row.state, version: row.version, pausedMs: row.pausedMs },
        newState: { state: newState, version: row.version + 1 },
        reason: parsed.data.reason ?? null,
        meta: { kind: row.kind, attempt: row.attempt, implicit: ctx.implicit },
        requestId,
      })

      const fresh = (await tx.recruitmentSession.findUnique({
        where: { id: row.id },
        select: SESSION_SELECT,
      })) as SessionRow

      revalidatePath("/recruitment")
      return { ok: true as const, idempotent: false, session: serialize(fresh, serverNow) }
    })
  } catch (err) {
    if (err instanceof SessionConflict) return { ok: false, error: err.message, conflict: err.conflict }
    return denied(err)
  }
}

// These delegate to transition(), which resolves the capability from
// LIFECYCLE_ACTION and guards with requireGroupAccess. Annotated so the static
// guard check in scripts/check-recruitment-guards.ts can see through the wrapper.
//
// @recruitment-guard session.pause
export async function pauseSession(input: { sessionId: string; expectedVersion?: number }) {
  return transition("pause", input)
}

// @recruitment-guard session.resume
export async function resumeSession(input: { sessionId: string; expectedVersion?: number }) {
  return transition("resume", input)
}

// @recruitment-guard session.finish
export async function finishSession(input: { sessionId: string; expectedVersion?: number }) {
  return transition("finish", input)
}

// @recruitment-guard session.abort
export async function abortSession(input: {
  sessionId: string
  expectedVersion?: number
  reason?: string
}) {
  return transition("abort", input)
}

// ---------------------------------------------------------------------------
// Take control: recovers a session whose owner disconnected
// ---------------------------------------------------------------------------

export async function takeSessionControl(input: {
  sessionId: string
  expectedVersion?: number
}): Promise<SessionResult> {
  const parsed = sessionActionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid request." }

  const found = await prisma.recruitmentSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: { groupId: true },
  })
  if (!found) return { ok: false, error: "Session not found." }

  try {
    const { ctx } = await requireGroupAccess(found.groupId, "session.takeControl")

    return await prisma.$transaction(async (tx) => {
      const serverNow = new Date()
      await tx.$queryRaw`SELECT id FROM "RecruitmentSession" WHERE id = ${parsed.data.sessionId} FOR UPDATE`

      const row = (await tx.recruitmentSession.findUnique({
        where: { id: parsed.data.sessionId },
        select: SESSION_SELECT,
      })) as SessionRow | null
      if (!row) return { ok: false as const, error: "Session not found." }

      const decision = decideTakeControl(toSnapshot(row), {
        actorId: ctx.userId,
        expectedVersion: parsed.data.expectedVersion,
        serverNow,
      })
      if (decision === "noop") {
        return { ok: true as const, idempotent: true, session: serialize(row, serverNow) }
      }
      if (decision === "conflict") {
        return {
          ok: false as const,
          error: "Another maintainer still holds this session. Wait for their claim to lapse.",
          conflict: serialize(row, serverNow),
        }
      }

      const updated = await tx.recruitmentSession.updateMany({
        where: { id: row.id, version: row.version },
        data: {
          controllerId: ctx.userId,
          controlExpiresAt: nextControlExpiry(serverNow),
          lastActivityAt: serverNow,
          version: { increment: 1 },
        },
      })
      if (updated.count === 0) {
        const fresh = (await tx.recruitmentSession.findUnique({
          where: { id: row.id },
          select: SESSION_SELECT,
        })) as SessionRow
        throw new SessionConflict("Someone else claimed control first.", serialize(fresh, serverNow))
      }

      await auditRecruitmentTx(tx, {
        eventType: "session.takeControl",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: row.cycleId,
        sessionId: row.id,
        groupId: row.groupId,
        previousState: { controllerId: row.controllerId },
        newState: { controllerId: ctx.userId },
        reason: "Previous controller's claim had lapsed.",
      })

      const fresh = (await tx.recruitmentSession.findUnique({
        where: { id: row.id },
        select: SESSION_SELECT,
      })) as SessionRow
      revalidatePath("/recruitment")
      return { ok: true as const, idempotent: false, session: serialize(fresh, serverNow) }
    })
  } catch (err) {
    if (err instanceof SessionConflict) return { ok: false, error: err.message, conflict: err.conflict }
    return denied(err)
  }
}

// ---------------------------------------------------------------------------
// Reopen: admin repair for a wrongly-completed session
// ---------------------------------------------------------------------------

// Creates the NEXT attempt rather than mutating the completed row, so the original
// timings, evaluations and audit trail survive intact.
export async function reopenSession(input: {
  sessionId: string
  reason: string
}): Promise<SessionResult> {
  const found = await prisma.recruitmentSession.findUnique({
    where: { id: input.sessionId },
    select: { cycleId: true, groupId: true },
  })
  if (!found) return { ok: false, error: "Session not found." }
  if (!input.reason || input.reason.trim().length < 10) {
    return { ok: false, error: "Give a reason of at least 10 characters for reopening." }
  }

  try {
    const ctx = await requireRecruitmentAction(found.cycleId, "session.reopen")

    return await prisma.$transaction(async (tx) => {
      const serverNow = new Date()
      const row = (await tx.recruitmentSession.findUnique({
        where: { id: input.sessionId },
        select: SESSION_SELECT,
      })) as SessionRow | null
      if (!row) return { ok: false as const, error: "Session not found." }

      if (decideReopen(toSnapshot(row)) === "noop") {
        return { ok: false as const, error: "That session is still live: there is nothing to reopen." }
      }

      // The partial unique index refuses a second non-terminal session per group,
      // so a concurrent reopen fails here rather than creating two live attempts.
      let created
      try {
        created = await tx.recruitmentSession.create({
          data: {
            cycleId: row.cycleId,
            groupId: row.groupId,
            kind: row.kind,
            attempt: row.attempt + 1,
            state: "NOT_STARTED",
            plannedSeconds: row.plannedSeconds,
            reopenedFromId: row.id,
            reopenReason: input.reason.trim(),
          },
          select: SESSION_SELECT,
        })
      } catch (createErr) {
        if (isUniqueViolation(createErr)) {
          throw new SessionConflict("This group already has a live session: reopening again would duplicate it.")
        }
        throw createErr
      }

      await tx.recruitmentGroup.update({ where: { id: row.groupId }, data: { state: "READY" } })

      await auditRecruitmentTx(tx, {
        eventType: "session.reopen",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: row.cycleId,
        sessionId: created.id,
        groupId: row.groupId,
        previousState: { sessionId: row.id, state: row.state, attempt: row.attempt },
        newState: { sessionId: created.id, state: "NOT_STARTED", attempt: created.attempt },
        reason: input.reason.trim(),
        meta: { implicit: ctx.implicit, reopenedFrom: row.id },
      })

      revalidatePath("/recruitment")
      return {
        ok: true as const,
        idempotent: false,
        session: serialize(created as SessionRow, serverNow),
      }
    })
  } catch (err) {
    if (err instanceof SessionConflict) return { ok: false, error: err.message, conflict: err.conflict }
    return denied(err)
  }
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export async function setAttendance(input: {
  groupMemberId: string
  attendance: "EXPECTED" | "PRESENT" | "LATE" | "ABSENT"
}): Promise<{ ok: boolean; error?: string }> {
  const member = await prisma.recruitmentGroupMember.findUnique({
    where: { id: input.groupMemberId },
    select: { groupId: true, candidateId: true, attendance: true, group: { select: { cycleId: true } } },
  })
  if (!member) return { ok: false, error: "Not found." }

  try {
    const { ctx } = await requireGroupAccess(member.groupId, "session.markAttendance")
    if (member.attendance === input.attendance) return { ok: true } // idempotent

    await prisma.$transaction(async (tx) => {
      await tx.recruitmentGroupMember.update({
        where: { id: input.groupMemberId },
        data: {
          attendance: input.attendance,
          // A late arrival is recorded with the moment they actually joined.
          joinedAt:
            input.attendance === "PRESENT" || input.attendance === "LATE" ? new Date() : null,
        },
      })
      await auditRecruitmentTx(tx, {
        eventType: "candidate.attendance",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: member.group.cycleId,
        candidateId: member.candidateId,
        groupId: member.groupId,
        previousState: { attendance: member.attendance },
        newState: { attendance: input.attendance },
      })
    })

    revalidatePath("/recruitment")
    return { ok: true }
  } catch (err) {
    const r = denied(err)
    return { ok: false, error: r.ok ? undefined : r.error }
  }
}

// ---------------------------------------------------------------------------

class SessionConflict extends Error {
  constructor(
    message: string,
    readonly conflict?: SerializedSession,
  ) {
    super(message)
    this.name = "SessionConflict"
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  )
}
