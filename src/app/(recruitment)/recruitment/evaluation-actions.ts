"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import {
  RecruitmentDenied,
  requireGroupAccess,
  requireRecruitmentAction,
  type RecruitmentContext,
} from "@/lib/recruitment/authz"
import { auditRecruitmentTx, newRequestId } from "@/lib/recruitment/audit"
import {
  criteriaFor,
  evaluationInputSchema,
  parseCycleConfig,
  recommendationAllowed,
  validateScores,
  type EvaluationInput,
} from "@/lib/schemas/recruitment"
import { isSchemaDrift, SCHEMA_DRIFT_MESSAGE } from "@/lib/prisma-errors"

// Evaluations are append-only. A revision inserts a NEW row and marks the previous
// one SUPERSEDED in the same transaction: an earlier score is never overwritten,
// so "who said what, when" survives forever.
//
// Three guarantees the DB enforces alongside this code:
//   · RecruitmentEvaluation_one_open : one open row per (session, evaluator,
//     candidate), so two evaluators never collide and a retry cannot duplicate.
//   · idempotencyKey @unique         : a retried submit collapses onto its
//     original row instead of creating a second score.
//   · evaluatorRole is denormalised  : revoking someone's role later must not
//     rewrite the attribution on a score they already gave.

// The saved row, as the server left it.
//
// The client used to learn only the id and the score, then wait for an RSC
// refresh to discover everything else. That made the screen depend on a refetch
// landing: EvaluationForm re-seeds its fields whenever the row id changes, and a
// revision ALWAYS mints a new id, so a refresh carrying the pre-write row would
// overwrite what the evaluator had just typed -- a save that visibly undid
// itself. Returning the row lets the form adopt it immediately, the same way
// SessionControls already adopts the session every action returns.
export interface SavedEvaluation {
  id: string
  state: "DRAFT" | "SUBMITTED"
  version: number
  overall: number | null
  submittedAt: string | null
}

export type EvaluationResult =
  | {
      ok: true
      evaluationId: string
      idempotent: boolean
      overall: number | null
      saved: SavedEvaluation
    }
  | { ok: false; error: string; errors?: string[] }

// Narrow a freshly written row into the shape the client adopts.
function savedFrom(row: {
  id: string
  state: string
  version: number
  overall: number | null
  submittedAt: Date | null
}): SavedEvaluation {
  return {
    id: row.id,
    state: row.state === "SUBMITTED" ? "SUBMITTED" : "DRAFT",
    version: row.version,
    overall: row.overall,
    submittedAt: row.submittedAt?.toISOString() ?? null,
  }
}

function denied(err: unknown): EvaluationResult {
  if (err instanceof RecruitmentDenied) {
    return {
      ok: false,
      error:
        err.detail === "cycle-state"
          ? "This recruitment cycle's current state does not allow scoring."
          : err.detail === "not-assigned"
            ? "You are not assigned to this group."
            : "You are not permitted to submit an evaluation here.",
    }
  }
  // A migration merged but never applied leaves the code writing values the
  // database does not have. That is a skipped deploy step, not a bug in
  // here, and saying so is the difference between a two-minute fix and a hunt.
  if (isSchemaDrift(err)) return { ok: false, error: SCHEMA_DRIFT_MESSAGE }
  console.error("[recruitment/evaluation]", err)
  return { ok: false, error: "Something went wrong. Reload and try again." }
}

interface Target {
  cycleId: string
  kind: "GD" | "PI"
  groupId: string | null
  sessionId: string | null
  config: unknown
}

// Resolve which cycle/kind/group an evaluation belongs to from either the session
// (normal case) or the candidate (a PI recorded without a formal session row).
async function resolveTarget(input: EvaluationInput): Promise<Target | null> {
  if (input.sessionId) {
    const session = await prisma.recruitmentSession.findUnique({
      where: { id: input.sessionId },
      select: { cycleId: true, kind: true, groupId: true, cycle: { select: { config: true } } },
    })
    if (!session) return null
    return {
      cycleId: session.cycleId,
      kind: session.kind,
      groupId: session.groupId,
      sessionId: input.sessionId,
      config: session.cycle.config,
    }
  }

  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { id: input.candidateId },
    select: { cycleId: true, stage: true, cycle: { select: { config: true } } },
  })
  if (!candidate) return null
  // Infer the round from where the candidate currently is.
  const kind = candidate.stage.startsWith("GD") ? "GD" : "PI"
  return { cycleId: candidate.cycleId, kind, groupId: null, sessionId: null, config: candidate.cycle.config }
}

async function saveEvaluation(
  input: EvaluationInput,
  mode: "draft" | "submit",
): Promise<EvaluationResult> {
  const parsed = evaluationInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "Invalid evaluation.", errors: parsed.error.issues.map((i) => i.message) }
  }
  const data = parsed.data

  const target = await resolveTarget(data)
  if (!target) return { ok: false, error: "Could not find the session or candidate." }

    const action = mode === "draft" ? "evaluation.draft" : "evaluation.submit"

  try {
    // Group-scoped when there is a group (enforces the JC canEvaluate flag);
    // cycle-scoped otherwise.
    // Everyone scores as themselves. The delegated path that used to sit here --
    // a panel lead recording a score on another panelist's behalf from a shared
    // laptop -- is gone along with its picker: one operator drives the site while
    // the panel deliberates off it, so nobody ever used it. Who sat on the panel
    // is still recorded, on the group's staff roster.
    const ctx: RecruitmentContext = target.groupId
      ? (await requireGroupAccess(target.groupId, action)).ctx
      : await requireRecruitmentAction(target.cycleId, action)

    if (mode === "submit" && !data.recommendation) {
      return {
        ok: false,
        error: "Choose Selected, Hold, or Reject before submitting.",
      }
    }

    // The form offers the round's options, but stale clients and direct calls
    // still have to pass the same server-owned allow-list.
    if (data.recommendation && !recommendationAllowed(target.kind, data.recommendation)) {
      return {
        ok: false,
        error: `A ${target.kind} evaluation cannot recommend ${data.recommendation}.`,
      }
    }

    const criteria = criteriaFor(parseCycleConfig(target.config), target.kind)
    // A draft may be partial; a submission must be complete.
    const validation = validateScores(data.scores, criteria, { requireAll: mode === "submit" })
    if (!validation.ok) {
      return { ok: false, error: "Fix the scores before saving.", errors: validation.errors }
    }

    // The candidate must actually belong to this session's group.
    if (target.groupId) {
      const isMember = await prisma.recruitmentGroupMember.count({
        where: { groupId: target.groupId, candidateId: data.candidateId, attendance: { not: "REASSIGNED" } },
      })
      if (isMember === 0) return { ok: false, error: "That candidate is not in this group." }
    }

    const evaluatorId = ctx.userId
    const evaluatorRole = ctx.role

    const requestId = newRequestId()
    return await prisma.$transaction(async (tx) => {
      // Idempotency first: a retried submit returns the original row untouched.
      if (data.idempotencyKey) {
        const existing = await tx.recruitmentEvaluation.findUnique({
          where: { idempotencyKey: data.idempotencyKey },
          select: {
            id: true,
            overall: true,
            evaluatorId: true,
            version: true,
            state: true,
            submittedAt: true,
          },
        })
        if (existing) {
          if (existing.evaluatorId !== evaluatorId) {
            return { ok: false as const, error: "That submission key belongs to another evaluator." }
          }
          return {
            ok: true as const,
            evaluationId: existing.id,
            idempotent: true,
            overall: existing.overall,
            saved: savedFrom(existing),
          }
        }
      }

      // The open row for THIS evaluator only. Other evaluators' rows are untouched,
      // which is what lets a panel score independently.
      const open = await tx.recruitmentEvaluation.findFirst({
        where: {
          candidateId: data.candidateId,
          sessionId: target.sessionId,
          evaluatorId,
          state: { in: ["DRAFT", "SUBMITTED"] },
        },
        select: { id: true, state: true, version: true, scores: true, overall: true, remarks: true },
      })

      // Stale editor: someone (you, elsewhere) already moved this on.
      if (open && data.expectedVersion !== undefined && open.version !== data.expectedVersion) {
        return {
          ok: false as const,
          error: "This evaluation was updated elsewhere. Reload to see the current version.",
        }
      }

      // A still-DRAFT row is edited in place: a draft is scratch space, not history.
      if (open && open.state === "DRAFT") {
        const updated = await tx.recruitmentEvaluation.update({
          where: { id: open.id },
          data: {
            scores: data.scores,
            overall: validation.overall,
            remarks: data.remarks ?? null,
            recommendation: data.recommendation ?? null,
            state: mode === "submit" ? "SUBMITTED" : "DRAFT",
            submittedAt: mode === "submit" ? new Date() : null,
            idempotencyKey: data.idempotencyKey ?? null,
            evaluatorRole,
          },
          select: { id: true, overall: true, version: true, state: true, submittedAt: true },
        })

        await auditRecruitmentTx(tx, {
          eventType: mode === "submit" ? "evaluation.submit" : "evaluation.draft",
          actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
          cycleId: target.cycleId,
          candidateId: data.candidateId,
          sessionId: target.sessionId,
          evaluationId: updated.id,
          groupId: target.groupId,
          previousState: { state: open.state, overall: open.overall },
          newState: { state: mode === "submit" ? "SUBMITTED" : "DRAFT", overall: validation.overall },
          meta: {
            kind: target.kind,
            version: updated.version,
            implicit: ctx.implicit,
            recordedForUserId: evaluatorId,
          },
          requestId,
        })

        if (mode === "submit") await touchSession(tx, target.sessionId)
        revalidatePath("/recruitment", "layout")
        return {
          ok: true as const,
          evaluationId: updated.id,
          idempotent: false,
          overall: updated.overall,
          saved: savedFrom(updated),
        }
      }

      // Already SUBMITTED → this is a revision, which needs its own capability.
      if (open && open.state === "SUBMITTED") {
        try {
          await requireRecruitmentAction(target.cycleId, "evaluation.revise")
        } catch (reviseErr) {
          return denied(reviseErr) as EvaluationResult
        }

        // Supersede first so the partial unique index has a free slot, then insert
        // the new version. Both in one transaction: there is never a moment with
        // two open rows or none.
        await tx.recruitmentEvaluation.update({
          where: { id: open.id },
          data: { state: "SUPERSEDED" },
        })

        const created = await tx.recruitmentEvaluation.create({
          data: {
            cycleId: target.cycleId,
            candidateId: data.candidateId,
            kind: target.kind,
            groupId: target.groupId,
            sessionId: target.sessionId,
            evaluatorId,
            evaluatorRole,
            scores: data.scores,
            overall: validation.overall,
            remarks: data.remarks ?? null,
            recommendation: data.recommendation ?? null,
            state: mode === "submit" ? "SUBMITTED" : "DRAFT",
            submittedAt: mode === "submit" ? new Date() : null,
            version: open.version + 1,
            supersedesId: open.id,
            idempotencyKey: data.idempotencyKey ?? null,
          },
          select: { id: true, overall: true, version: true, state: true, submittedAt: true },
        })

        await auditRecruitmentTx(tx, {
          eventType: "evaluation.revise",
          actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
          cycleId: target.cycleId,
          candidateId: data.candidateId,
          sessionId: target.sessionId,
          evaluationId: created.id,
          groupId: target.groupId,
          previousState: { evaluationId: open.id, overall: open.overall, version: open.version },
          newState: { evaluationId: created.id, overall: created.overall, version: created.version },
          reason: "Evaluator revised a submitted score; the previous version was superseded, not replaced.",
          meta: {
            kind: target.kind,
            supersedes: open.id,
            implicit: ctx.implicit,
            recordedForUserId: evaluatorId,
          },
          requestId,
        })

        await touchSession(tx, target.sessionId)
        revalidatePath("/recruitment", "layout")
        return {
          ok: true as const,
          evaluationId: created.id,
          idempotent: false,
          overall: created.overall,
          saved: savedFrom(created),
        }
      }

      // First evaluation from this evaluator for this candidate.
      const created = await tx.recruitmentEvaluation.create({
        data: {
          cycleId: target.cycleId,
          candidateId: data.candidateId,
          kind: target.kind,
          groupId: target.groupId,
          sessionId: target.sessionId,
          evaluatorId,
          evaluatorRole,
          scores: data.scores,
          overall: validation.overall,
          remarks: data.remarks ?? null,
          recommendation: data.recommendation ?? null,
          state: mode === "submit" ? "SUBMITTED" : "DRAFT",
          submittedAt: mode === "submit" ? new Date() : null,
          version: 1,
          idempotencyKey: data.idempotencyKey ?? null,
        },
        select: { id: true, overall: true, version: true, state: true, submittedAt: true },
      })

      await auditRecruitmentTx(tx, {
        eventType: mode === "submit" ? "evaluation.submit" : "evaluation.draft",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: target.cycleId,
        candidateId: data.candidateId,
        sessionId: target.sessionId,
        evaluationId: created.id,
        groupId: target.groupId,
        newState: { state: mode === "submit" ? "SUBMITTED" : "DRAFT", overall: created.overall },
        meta: {
          kind: target.kind,
          version: 1,
          implicit: ctx.implicit,
          recordedForUserId: evaluatorId,
        },
        requestId,
      })

      if (mode === "submit") await touchSession(tx, target.sessionId)
      revalidatePath("/recruitment", "layout")
      return {
        ok: true as const,
        evaluationId: created.id,
        idempotent: false,
        overall: created.overall,
        saved: savedFrom(created),
      }
    })
  } catch (err) {
    // A unique-violation here means a concurrent submit from the same evaluator
    // won the race: treat it as the idempotent outcome it effectively is.
    if (isUniqueViolation(err)) {
      const existing = data.idempotencyKey
        ? await prisma.recruitmentEvaluation.findUnique({
            where: { idempotencyKey: data.idempotencyKey },
            select: { id: true, overall: true, version: true, state: true, submittedAt: true },
          })
        : null
      if (existing) {
        return {
          ok: true,
          evaluationId: existing.id,
          idempotent: true,
          overall: existing.overall,
          saved: savedFrom(existing),
        }
      }
      return {
        ok: false,
        error: "You already have an evaluation open for this candidate. Reload to see it.",
      }
    }
    return denied(err)
  }
}

// Both of these delegate to saveEvaluation(), which guards with the mode-dependent
// capability and additionally enforces the JC canEvaluate flag via
// requireGroupAccess. Annotated so the static guard check can see through the
// wrapper.
//
// @recruitment-guard evaluation.draft
export async function saveEvaluationDraft(input: EvaluationInput): Promise<EvaluationResult> {
  return saveEvaluation(input, "draft")
}

// @recruitment-guard evaluation.submit
export async function submitEvaluation(input: EvaluationInput): Promise<EvaluationResult> {
  return saveEvaluation(input, "submit")
}

// ---------------------------------------------------------------------------
// Void: admin repair. Marks a score void without deleting it.
// ---------------------------------------------------------------------------

// Keeps `lastActivityAt` fresh so a session with a working panel is never reported
// stale, and so a controller's claim does not lapse mid-GD.
async function touchSession(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sessionId: string | null,
): Promise<void> {
  if (!sessionId) return
  await tx.recruitmentSession.updateMany({
    where: { id: sessionId, state: { in: ["ACTIVE", "PAUSED"] } },
    data: { lastActivityAt: new Date() },
  })
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  )
}
