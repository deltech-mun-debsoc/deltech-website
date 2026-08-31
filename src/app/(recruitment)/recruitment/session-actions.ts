"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import {
  RecruitmentDenied,
  requireGroupAccess,
  requireRecruitmentAction,
} from "@/lib/recruitment/authz"
import { auditRecruitmentTx, auditRecruitmentManyTx, newRequestId } from "@/lib/recruitment/audit"
import {
  accumulatedPauseMs,
  decideAbort,
  decideFinish,
  decidePause,
  decideReopen,
  decideResume,
  decideStart,
  nextControlExpiry,
  type SessionSnapshot,
  type SessionStateName,
} from "@/lib/recruitment/session"
import {
  criteriaFor,
  parseCycleConfig,
  resolvePanelRecommendation,
  sessionActionSchema,
  validateScores,
  type PanelRecommendation,
} from "@/lib/schemas/recruitment"
import type { Prisma } from "@/generated/prisma/client"
import {
  isSchemaDrift,
  SCHEMA_DRIFT_MESSAGE,
  failureRef,
  unexpectedFailureMessage,
} from "@/lib/prisma-errors"

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
  cycle: { config: unknown }
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
  // Needed on finish, to validate which drafts are complete enough to submit.
  cycle: { select: { config: true } },
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
  // A migration merged but never applied leaves the code writing values the
  // database does not have. That is a skipped deploy step, not a bug in
  // here, and saying so is the difference between a two-minute fix and a hunt.
  if (isSchemaDrift(err)) return { ok: false, error: SCHEMA_DRIFT_MESSAGE }
  // A reference the operator can read off the screen and quote. It is logged
  // beside the exception, so diagnosing the next one is a grep rather than a hunt.
  const ref = failureRef(err)
  console.error("[recruitment/session]", ref.ref, ref.code ?? "-", err)
  return { ok: false, error: unexpectedFailureMessage(ref) }
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
      // Starting two different interviews from two tabs must serialise on the
      // operator, not only on each session row. This makes "one interview per
      // account" true even when both clicks land at the same millisecond.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ctx.userId} FOR UPDATE`
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

      if (row.kind === "PI") {
        const otherInterview = await tx.recruitmentSession.findFirst({
          where: {
            id: { not: row.id },
            kind: "PI",
            state: { in: ["ACTIVE", "PAUSED"] },
            controllerId: ctx.userId,
          },
          select: { id: true },
        })
        if (otherInterview) {
          return {
            ok: false as const,
            error: "Finish or abort your current interview before starting another one.",
          }
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

      // Starting a rostered session confirms participation. Reassignment stays
      // as internal history, but attendance is not a separate operator workflow.
      await tx.recruitmentGroupMember.updateMany({
        where: { groupId: row.groupId, attendance: { not: "REASSIGNED" } },
        data: { attendance: "PRESENT", joinedAt: serverNow },
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

      revalidatePath("/recruitment", "layout")
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

      const finishRecommendations = new Map<string, PanelRecommendation>()
      if (kind === "finish") {
        const roster = await tx.recruitmentGroupMember.findMany({
          where: { groupId: row.groupId, attendance: { not: "REASSIGNED" } },
          select: { candidateId: true, candidate: { select: { fullName: true } } },
        })

        // Finishing submits the panel's work. Scoring a group used to mean
        // pressing Submit once per candidate and then Finish -- eight taps for a
        // group of seven, and a refusal if you missed one. The console autosaves
        // each score as a draft, and finishing promotes every complete draft of
        // yours in the same transaction that applies the verdict.
        //
        // DECIDE FIRST, WRITE SECOND. Returning a value from a Prisma transaction
        // COMMITS it -- only a throw rolls back -- so promoting drafts before the
        // completeness check left half the panel submitted by a finish that was
        // then refused. Nothing below writes until the whole roster is settled.
        const criteria = criteriaFor(parseCycleConfig(row.cycle.config), row.kind)
        const promotable = (
          await tx.recruitmentEvaluation.findMany({
            where: {
              sessionId: row.id,
              evaluatorId: ctx.userId,
              state: "DRAFT",
              candidateId: { in: roster.map((member) => member.candidateId) },
            },
            select: { id: true, candidateId: true, scores: true, recommendation: true, overall: true },
          })
        ).filter(
          (draft) =>
            Boolean(draft.recommendation) &&
            validateScores((draft.scores ?? {}) as Record<string, number>, criteria, {
              requireAll: true,
            }).ok,
        )

        const submitted = await tx.recruitmentEvaluation.findMany({
          where: {
            sessionId: row.id,
            candidateId: { in: roster.map((member) => member.candidateId) },
            state: "SUBMITTED",
          },
          select: { candidateId: true, recommendation: true },
        })
        // The drafts about to be promoted count towards the verdict, exactly as
        // they will once written.
        const evaluations = [
          ...submitted,
          ...promotable.map((draft) => ({
            candidateId: draft.candidateId,
            recommendation: draft.recommendation,
          })),
        ]

        const missing: string[] = []
        for (const member of roster) {
          const recommendation = resolvePanelRecommendation(
            evaluations
              .filter((evaluation) => evaluation.candidateId === member.candidateId)
              .map((evaluation) => evaluation.recommendation as PanelRecommendation | null),
          )
          if (!recommendation) {
            // Name them. "Every candidate" sends the panel hunting through a
            // group of seven for the one card they have not finished, and now
            // that scores save themselves the only thing that can be missing is
            // a recommendation.
            missing.push(member.candidate.fullName)
            continue
          }
          finishRecommendations.set(member.candidateId, recommendation)
        }

        if (missing.length > 0) {
          return {
            ok: false as const,
            error: `Choose Selected, Hold or Reject for ${missing.join(", ")} before finishing.`,
          }
        }

        // Settled. Now write -- in two round trips rather than two per candidate.
        //
        // This loop used to issue an update and an audit insert per draft. Inside a
        // transaction with a five-second ceiling that is a cost that grows with the
        // size of the panel, and on a remote database a large enough panel would
        // simply run out of budget mid-finish.
        if (promotable.length > 0) {
          await tx.recruitmentEvaluation.updateMany({
            where: { id: { in: promotable.map((draft) => draft.id) } },
            data: { state: "SUBMITTED", submittedAt: serverNow },
          })
          await auditRecruitmentManyTx(
            tx,
            promotable.map((draft) => ({
              eventType: "evaluation.submit",
              actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
              cycleId: row.cycleId,
              candidateId: draft.candidateId,
              sessionId: row.id,
              evaluationId: draft.id,
              groupId: row.groupId,
              previousState: { state: "DRAFT" },
              newState: { state: "SUBMITTED", overall: draft.overall },
              meta: { kind: row.kind, submittedOnFinish: true },
              requestId,
            })),
          )
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
          const present = members.map((member) => member.candidateId)
          const activeStage = row.kind === "GD" ? "GD_ACTIVE" : "PI_ACTIVE"
          const completeStage = row.kind === "GD" ? "GD_COMPLETE" : "PI_COMPLETE"

          await tx.recruitmentCandidate.updateMany({
            where: { id: { in: present }, stage: activeStage },
            data: { stage: completeStage },
          })

          const advancing = await tx.recruitmentCandidate.findMany({
            where: { id: { in: present }, stage: completeStage },
            select: { id: true, stage: true, result: true, gdRequired: true, piRequired: true, version: true },
          })

          const handoffs: Prisma.RecruitmentHandoffCreateManyInput[] = []
          const transitions: Parameters<typeof auditRecruitmentManyTx>[1][number][] = []

          for (const candidate of advancing) {
            // Never overwrite a concurrent manual decision made while the session
            // was live. Its version/result remains authoritative.
            //
            // ON_HOLD is the exception, and it has to be: the PI queue deliberately
            // re-offers held candidates, so re-interviewing one is a supported move.
            // Treating their existing hold as "already decided" meant the second
            // panel's verdict was silently discarded and the candidate came to rest
            // at PI_COMPLETE with no queue and no decision. A hold is a question
            // still open, not an answer.
            if (candidate.result !== "PENDING" && candidate.result !== "ON_HOLD") continue
            const recommendation = finishRecommendations.get(candidate.id)
            if (!recommendation) continue

            const proceedsFromGd = row.kind === "GD" && recommendation !== "REJECT" && candidate.piRequired
            const to = proceedsFromGd ? "PI_PENDING" : "CLOSED"
            const result = proceedsFromGd
              ? "PENDING"
              : recommendation === "SELECT"
                ? "SELECTED"
                : recommendation === "HOLD"
                  ? "ON_HOLD"
                  : "REJECTED"

            const moved = await tx.recruitmentCandidate.updateMany({
              where: { id: candidate.id, stage: candidate.stage, version: candidate.version },
              data: {
                stage: to,
                result,
                version: { increment: 1 },
                ...(to === "CLOSED" ? { decidedById: ctx.userId, decidedAt: serverNow } : {}),
              },
            })
            if (moved.count === 0) continue

            // Collected, not written yet. The stage move above has to stay
            // per-candidate -- it is guarded on that candidate's own stage and
            // version, which a bulk update cannot express -- but its handoff and
            // audit rows are plain inserts, so they go out together below.
            handoffs.push({
              cycleId: row.cycleId,
              candidateId: candidate.id,
              fromStage: candidate.stage,
              toStage: to,
              reason: `${recommendation} panel recommendation applied when the ${row.kind} session finished.`,
              actorId: ctx.userId,
              actorRole: ctx.role,
              sessionId: row.id,
              previousState: { stage: candidate.stage },
              newState: { stage: to, result },
            })

            transitions.push({
              eventType: "candidate.transition",
              actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
              cycleId: row.cycleId,
              candidateId: candidate.id,
              sessionId: row.id,
              groupId: row.groupId,
              previousState: { stage: candidate.stage },
              newState: { stage: to, result },
              reason: `${recommendation} panel recommendation applied when the ${row.kind} session finished.`,
              meta: { automatic: true, sessionKind: row.kind, recommendation },
              requestId,
            })
          }

          if (handoffs.length > 0) await tx.recruitmentHandoff.createMany({ data: handoffs })
          await auditRecruitmentManyTx(tx, transitions)
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

      revalidatePath("/recruitment", "layout")
      return { ok: true as const, idempotent: false, session: serialize(fresh, serverNow) }
      },
      // Finishing writes the panel's verdict for every candidate at once. Prisma's
      // default interactive ceiling is five seconds, which is generous in-process
      // and thin against a remote database: the fixed cost is a dozen round trips
      // before any candidate is even considered. Batched writes keep this well
      // inside the limit; the raised ceiling is headroom, not a licence to grow.
      { timeout: 30_000 },
    )
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
// Reopen: admin repair for a wrongly-completed session
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

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
