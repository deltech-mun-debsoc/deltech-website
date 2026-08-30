"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { RecruitmentDenied, requireRecruitmentAction, resolveCycleContext } from "@/lib/recruitment/authz"
import { auditRecruitmentTx, newRequestId } from "@/lib/recruitment/audit"
import { can, cycleAllows } from "@/lib/recruitment/permissions"
import {
  actionForResult,
  canTransitionResult,
  decideTransition,
  type CandidateResultName,
  type CandidateSnapshot,
  type CandidateStageName,
} from "@/lib/recruitment/transitions"
import { parseCycleConfig } from "@/lib/schemas/recruitment"
import { bypassGdSchema, resultMoveSchema, stageMoveSchema } from "@/lib/schemas/recruitment"

// Candidate stage and result changes. Every move goes through the pure state
// machine in src/lib/recruitment/transitions.ts, is applied as a conditional
// update on { id, version }, and writes both a RecruitmentHandoff (the traceable
// stage move) and a RecruitmentAuditEvent in the same transaction.
//
// Refused moves are audited with outcome REJECTED rather than silently dropped,
// the spec asks for failed transitions to be visible.

export type CandidateResultResponse =
  | { ok: true; stage?: string; result?: string; version: number; idempotent: boolean }
  | { ok: false; error: string }

const REFUSAL_MESSAGE: Record<string, string> = {
  "not-permitted": "You are not permitted to make that change.",
  "illegal-transition": "That stage does not apply to this candidate.",
  "stage-requires-override": "That jump needs an administrator override.",
  "session-active": "This candidate is in a live session. End it first, or use an admin override.",
}

function denied(err: unknown): CandidateResultResponse {
  if (err instanceof RecruitmentDenied) {
    return {
      ok: false,
      error:
        err.detail === "cycle-state"
          ? "This recruitment cycle's current state does not allow that."
          : err.detail === "not-assigned"
            ? "You are not assigned to this recruitment cycle."
            : "You are not permitted to do that.",
    }
  }
  console.error("[recruitment/candidate]", err)
  return { ok: false, error: "Something went wrong. Reload and try again." }
}

const CANDIDATE_SELECT = {
  id: true,
  cycleId: true,
  fullName: true,
  stage: true,
  result: true,
  gdRequired: true,
  piRequired: true,
  version: true,
} as const

// ---------------------------------------------------------------------------
// Stage moves
// ---------------------------------------------------------------------------

// The required capability depends on where the candidate is going, so it is
// resolved at runtime by actionForTransition() and checked inside
// decideTransition()'s `permitted` callback. The annotation below lists every
// capability this action can demand; scripts/check-recruitment-guards.ts validates
// each one against the matrix, so the dynamic dispatch stays as auditable as a
// literal guard.
//
// @recruitment-guard candidate.advance, candidate.bypassGd, candidate.override, candidate.reconsider
export async function moveCandidateStage(input: {
  candidateId: string
  to: CandidateStageName
  reason?: string
  override?: boolean
  expectedVersion?: number
}): Promise<CandidateResultResponse> {
  const parsed = stageMoveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid request." }
  const data = parsed.data

  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { id: data.candidateId },
    select: CANDIDATE_SELECT,
  })
  if (!candidate) return { ok: false, error: "Candidate not found." }

  const ctx = await resolveCycleContext(candidate.cycleId)
  if (!ctx) return { ok: false, error: "You are not assigned to this recruitment cycle." }

  // Is the candidate mid-session right now? This is what protects an in-flight
  // evaluation from having the candidate moved out from under it.
  const activeLock = await prisma.recruitmentCandidateLock.count({
    where: { candidateId: candidate.id },
  })

  const snapshot: CandidateSnapshot = {
    stage: candidate.stage,
    result: candidate.result,
    gdRequired: candidate.gdRequired,
    piRequired: candidate.piRequired,
  }

  const decision = decideTransition(
    snapshot,
    { to: data.to, override: data.override, hasActiveSession: activeLock > 0 },
    (action) => can(ctx.role, action) && cycleAllows(ctx.cycle.state, action),
  )

  if (!decision.ok) {
    // Record the refusal, then tell the caller why.
    await auditRecruitmentTx(prisma, {
      eventType: "candidate.transition",
      actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
      cycleId: candidate.cycleId,
      candidateId: candidate.id,
      previousState: { stage: candidate.stage },
      newState: { stage: data.to },
      reason: `Refused: ${decision.refusal}.`,
      meta: { attemptedAction: decision.action, refusal: decision.refusal, override: data.override },
      outcome: "REJECTED",
    }).catch(() => undefined)
    return { ok: false, error: REFUSAL_MESSAGE[decision.refusal ?? ""] ?? "That change is not allowed." }
  }

  // Nothing to do: a retry of a move that already landed.
  if (candidate.stage === data.to) {
    return { ok: true, stage: candidate.stage, version: candidate.version, idempotent: true }
  }

  if (data.override && !data.reason) {
    return { ok: false, error: "An override needs a reason." }
  }

  try {
    const requestId = newRequestId()

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.recruitmentCandidate.updateMany({
        where: { id: candidate.id, version: candidate.version, stage: candidate.stage },
        data: { stage: data.to, version: { increment: 1 } },
      })
      // Someone changed this candidate between our read and our write.
      if (updated.count === 0) {
        return {
          ok: false as const,
          error: "This candidate was updated by someone else. Reload to see the current state.",
        }
      }

      await tx.recruitmentHandoff.create({
        data: {
          cycleId: candidate.cycleId,
          candidateId: candidate.id,
          fromStage: candidate.stage,
          toStage: data.to,
          bypass: false,
          reason: data.reason ?? null,
          actorId: ctx.userId,
          actorRole: ctx.role,
          previousState: { stage: candidate.stage, version: candidate.version },
          newState: { stage: data.to, version: candidate.version + 1 },
        },
      })

      await auditRecruitmentTx(tx, {
        eventType: data.override ? "candidate.override" : "candidate.transition",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: candidate.cycleId,
        candidateId: candidate.id,
        previousState: { stage: candidate.stage, version: candidate.version },
        newState: { stage: data.to, version: candidate.version + 1 },
        reason: data.reason ?? null,
        meta: { action: decision.action, override: data.override, implicit: ctx.implicit },
        requestId,
      })

      revalidatePath("/recruitment", "layout")
      return { ok: true as const, stage: data.to, version: candidate.version + 1, idempotent: false }
    })
  } catch (err) {
    return denied(err)
  }
}

// ---------------------------------------------------------------------------
// GD bypass: send a candidate straight to PI
// ---------------------------------------------------------------------------

export async function bypassGd(input: {
  candidateId: string
  reason: string
}): Promise<CandidateResultResponse> {
  const parsed = bypassGdSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "A reason is required." }
  }

  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { id: parsed.data.candidateId },
    select: { ...CANDIDATE_SELECT, cycle: { select: { config: true } } },
  })
  if (!candidate) return { ok: false, error: "Candidate not found." }

  try {
    // JCs are refused here by the capability matrix, and the refusal is audited.
    const ctx = await requireRecruitmentAction(candidate.cycleId, "candidate.bypassGd")

    // A cycle may switch bypass off entirely, independent of role.
    const config = parseCycleConfig(candidate.cycle.config)
    if (!config.stages.allowGdBypass) {
      return { ok: false, error: "This recruitment cycle does not allow skipping GD." }
    }

    if (candidate.stage === "GD_BYPASSED") {
      return { ok: true, stage: candidate.stage, version: candidate.version, idempotent: true }
    }
    if (candidate.stage.startsWith("PI") || candidate.stage === "GD_COMPLETE") {
      return { ok: false, error: "This candidate is already past GD." }
    }

    const activeLock = await prisma.recruitmentCandidateLock.count({ where: { candidateId: candidate.id } })
    if (activeLock > 0) {
      return { ok: false, error: "This candidate is in a live GD right now. End that session first." }
    }

    const requestId = newRequestId()

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.recruitmentCandidate.updateMany({
        where: { id: candidate.id, version: candidate.version },
        data: {
          stage: "GD_BYPASSED",
          // The bypass is recorded as configuration, so the PI dossier can render
          // "intentionally skipped" rather than "GD data missing".
          gdRequired: false,
          version: { increment: 1 },
        },
      })
      if (updated.count === 0) {
        return { ok: false as const, error: "This candidate was updated by someone else. Reload." }
      }

      // Remove them from any pending GD group, keeping the row as history.
      await tx.recruitmentGroupMember.updateMany({
        where: { candidateId: candidate.id, kind: "GD", attendance: "PRESENT" },
        data: { attendance: "REASSIGNED" },
      })

      // The permanent audit event the spec requires: candidate, cycle, reason,
      // actor, actor role, timestamp.
      await tx.recruitmentHandoff.create({
        data: {
          cycleId: candidate.cycleId,
          candidateId: candidate.id,
          fromStage: candidate.stage,
          toStage: "GD_BYPASSED",
          bypass: true,
          reason: parsed.data.reason.trim(),
          actorId: ctx.userId,
          actorRole: ctx.role,
          previousState: { stage: candidate.stage, gdRequired: candidate.gdRequired },
          newState: { stage: "GD_BYPASSED", gdRequired: false },
        },
      })

      await auditRecruitmentTx(tx, {
        eventType: "candidate.bypassGd",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: candidate.cycleId,
        candidateId: candidate.id,
        previousState: { stage: candidate.stage, gdRequired: candidate.gdRequired },
        newState: { stage: "GD_BYPASSED", gdRequired: false },
        reason: parsed.data.reason.trim(),
        meta: { candidateName: candidate.fullName, implicit: ctx.implicit },
        requestId,
      })

      revalidatePath("/recruitment", "layout")
      return { ok: true as const, stage: "GD_BYPASSED", version: candidate.version + 1, idempotent: false }
    })
  } catch (err) {
    return denied(err)
  }
}

// Capability depends on the outcome being set (actionForResult), so it is passed
// to requireRecruitmentAction as a variable. The annotation enumerates every
// possibility for the static guard check.
//
// @recruitment-guard candidate.hold, candidate.withdraw, candidate.disqualify, candidate.finalise, candidate.reconsider
export async function setCandidateResult(input: {
  candidateId: string
  to: CandidateResultName
  reason?: string
  expectedVersion?: number
}): Promise<CandidateResultResponse> {
  const parsed = resultMoveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid request." }
  const data = parsed.data

  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { id: data.candidateId },
    select: { ...CANDIDATE_SELECT, recruitedUserId: true },
  })
  if (!candidate) return { ok: false, error: "Candidate not found." }

  const action = actionForResult(data.to)

  try {
    const ctx = await requireRecruitmentAction(candidate.cycleId, action)

    // Retry of a decision that already landed.
    if (candidate.result === data.to) {
      return { ok: true, result: candidate.result, version: candidate.version, idempotent: true }
    }

    if (!canTransitionResult(candidate.result, data.to)) {
      await auditRecruitmentTx(prisma, {
        eventType: "candidate.result",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: candidate.cycleId,
        candidateId: candidate.id,
        previousState: { result: candidate.result },
        newState: { result: data.to },
        reason: "Refused: illegal result transition.",
        meta: { attemptedAction: action },
        outcome: "REJECTED",
      }).catch(() => undefined)
      return { ok: false, error: `A ${candidate.result.toLowerCase()} candidate cannot become ${data.to.toLowerCase()}.` }
    }

    // Un-selecting somebody who is already in the society needs their membership
    // dealt with first: silently orphaning the link would corrupt the connection.
    if (candidate.recruitedUserId && data.to !== "SELECTED") {
      return {
        ok: false,
        error: "This candidate has already been added to the society. Remove their membership before changing the result.",
      }
    }

    if (data.expectedVersion !== undefined && data.expectedVersion !== candidate.version) {
      return { ok: false, error: "This candidate was updated elsewhere. Reload to see the current state." }
    }

    const requestId = newRequestId()

    // Which outcomes finish a candidate.
    //
    // A hold does NOT: it is a question still open, and the PI queue deliberately
    // re-offers held candidates -- but only at GD_COMPLETE, GD_BYPASSED or
    // PI_PENDING. Closing them on Hold put them in a stage no queue looks at, so
    // pressing Hold quietly removed the candidate from the process instead of
    // parking them in it. Same class of dead end as the finish-session bug fixed
    // in #86, on the manual path this time.
    const closes = data.to === "SELECTED" || data.to === "REJECTED" ||
      data.to === "WITHDRAWN" || data.to === "DISQUALIFIED"
    const nextStage = closes ? "CLOSED" : candidate.stage

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.recruitmentCandidate.updateMany({
        where: { id: candidate.id, version: candidate.version, result: candidate.result },
        data: {
          result: data.to,
          decidedById: ctx.userId,
          decidedAt: new Date(),
          version: { increment: 1 },
          ...(closes ? { stage: "CLOSED" as const } : {}),
        },
      })
      // Two admins finalising the same candidate: one wins, the other is told.
      if (updated.count === 0) {
        const fresh = await tx.recruitmentCandidate.findUnique({
          where: { id: candidate.id },
          select: { result: true },
        })
        return {
          ok: false as const,
          error: `Another administrator already set this candidate to ${fresh?.result.toLowerCase() ?? "another result"}.`,
        }
      }

      await auditRecruitmentTx(tx, {
        eventType: "candidate.result",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: candidate.cycleId,
        candidateId: candidate.id,
        previousState: { result: candidate.result, stage: candidate.stage, version: candidate.version },
        newState: { result: data.to, stage: nextStage, version: candidate.version + 1 },
        reason: data.reason ?? null,
        meta: { action, candidateName: candidate.fullName, implicit: ctx.implicit },
        requestId,
      })

      revalidatePath("/recruitment", "layout")
      revalidatePath("/admin/recruitment", "layout")
      return { ok: true as const, result: data.to, version: candidate.version + 1, idempotent: false }
    })
  } catch (err) {
    return denied(err)
  }
}

// ---------------------------------------------------------------------------
// Manual candidate edits: records which fields a human touched, so imports
// never overwrite them.
// ---------------------------------------------------------------------------

