"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireAdmin, requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { auditRecruitmentTx, newRequestId } from "@/lib/recruitment/audit"
import { RecruitmentDenied, requireRecruitmentAction } from "@/lib/recruitment/authz"
import { canTransitionCycle, type CycleStateName } from "@/lib/recruitment/permissions"
import {
  createCycleSchema,
  parseCycleConfig,
  recruitCandidateSchema,
  recruitmentCycleConfigSchema,
} from "@/lib/schemas/recruitment"
import type { RecruitmentRole, Role } from "@/generated/prisma/client"
import {
  isSchemaDrift,
  SCHEMA_DRIFT_MESSAGE,
  failureRef,
  unexpectedFailureMessage,
} from "@/lib/prisma-errors"

// The admin CONTROL PLANE for recruitment. Operational screens live under
// /recruitment; this file only creates and configures cycles, assigns staff,
// drives the cycle state machine, and converts a selected candidate into a
// society member.
//
// Everything here is ADMIN-only (see scripts/check-role-guards.ts, which pins it).

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string }

function denied(err: unknown): ActionResult {
  if (err instanceof RecruitmentDenied) {
    return {
      ok: false,
      error:
        err.detail === "cycle-state"
          ? "This cycle's current state does not allow that."
          : "You are not permitted to do that.",
    }
  }
  // A migration merged but never applied leaves the code writing values the
  // database does not have. That is a skipped deploy step, not a bug in
  // here, and saying so is the difference between a two-minute fix and a hunt.
  if (isSchemaDrift(err)) return { ok: false, error: SCHEMA_DRIFT_MESSAGE }
  // A reference the operator can read off the screen and quote. It is logged
  // beside the exception, so diagnosing the next one is a grep rather than a hunt.
  const ref = failureRef(err)
  console.error("[admin/recruitment]", ref.ref, ref.code ?? "-", err)
  return { ok: false, error: unexpectedFailureMessage(ref) }
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export async function createRecruitmentCycle(input: {
  name: string
  slug: string
}): Promise<ActionResult> {
  const session = await requireAdmin()
  const parsed = createCycleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid cycle." }
  }

  const userId = (session.user as { id?: string }).id
  if (!userId) return { ok: false, error: "Could not identify you. Sign in again." }

  try {
    const cycle = await prisma.$transaction(async (tx) => {
      const created = await tx.recruitmentCycle.create({
        data: {
          name: parsed.data.name.trim(),
          slug: parsed.data.slug,
          state: "DRAFT",
          // Sensible defaults so a new cycle is usable before anyone configures it.
          config: recruitmentCycleConfigSchema.parse({}),
          createdById: userId,
        },
        select: { id: true },
      })
      // The creator is an explicit member, not just an implicit global admin, so
      // the assignment list is never empty and the audit trail names them.
      await tx.recruitmentMember.create({
        data: {
          cycleId: created.id,
          userId,
          role: "ADMIN",
          assignedById: userId,
        },
      })
      await auditRecruitmentTx(tx, {
        eventType: "cycle.create",
        actor: { id: userId, email: session.user?.email ?? "unknown", role: "ADMIN" },
        cycleId: created.id,
        newState: { name: parsed.data.name.trim(), slug: parsed.data.slug, state: "DRAFT" },
      })
      return created
    })

    revalidatePath("/admin/recruitment", "layout")
    return { ok: true, id: cycle.id }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "A cycle with that slug already exists." }
    }
    return denied(err)
  }
}

export async function updateCycleConfig(input: {
  cycleId: string
  config: unknown
  expectedVersion?: number
}): Promise<ActionResult> {
  const parsed = recruitmentCycleConfigSchema.safeParse(input.config)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid configuration." }
  }

  try {
    const ctx = await requireRecruitmentAction(input.cycleId, "cycle.configure")

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.recruitmentCycle.updateMany({
        where: {
          id: input.cycleId,
          ...(input.expectedVersion !== undefined ? { version: input.expectedVersion } : {}),
        },
        data: { config: parsed.data, version: { increment: 1 } },
      })
      if (result.count === 0) return false

      await auditRecruitmentTx(tx, {
        eventType: "cycle.configure",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: input.cycleId,
        previousState: { config: parseCycleConfig(ctx.cycle.config) as never },
        newState: { config: parsed.data as never },
        meta: { implicit: ctx.implicit },
      })
      return true
    })

    if (!updated) {
      return { ok: false, error: "This cycle was reconfigured elsewhere. Reload and try again." }
    }

    revalidatePath("/admin/recruitment", "layout")
    revalidatePath("/recruitment", "layout")
    return { ok: true }
  } catch (err) {
    return denied(err)
  }
}

// Drives the cycle state machine. Open/close/pause/finalise are all this one
// action, because they are all the same guarded, audited transition.
export async function transitionCycle(input: {
  cycleId: string
  to: CycleStateName
  reason?: string
  expectedVersion?: number
}): Promise<ActionResult> {
  try {
    const ctx = await requireRecruitmentAction(input.cycleId, "cycle.transition")
    const from = ctx.cycle.state

    if (from === input.to) return { ok: true } // idempotent

    if (!canTransitionCycle(from, input.to)) {
      await auditRecruitmentTx(prisma, {
        eventType: "cycle.transition",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: input.cycleId,
        previousState: { state: from },
        newState: { state: input.to },
        reason: "Refused: illegal cycle transition.",
        outcome: "REJECTED",
      }).catch(() => undefined)
      return { ok: false, error: `A ${from.toLowerCase()} cycle cannot move to ${input.to.toLowerCase()}.` }
    }

    // Refuse to close a cycle out from under live sessions: that would leave
    // candidates locked and timers running with no way to finish them.
    if (input.to === "COMPLETED" || input.to === "CANCELLED" || input.to === "FINALISATION") {
      const live = await prisma.recruitmentSession.count({
        where: { cycleId: input.cycleId, state: { in: ["ACTIVE", "PAUSED"] } },
      })
      if (live > 0) {
        return {
          ok: false,
          error: `${live} session${live === 1 ? " is" : "s are"} still live. Finish or abort them first.`,
        }
      }
    }

    const applied = await prisma.$transaction(async (tx) => {
      const result = await tx.recruitmentCycle.updateMany({
        where: {
          id: input.cycleId,
          state: from,
          ...(input.expectedVersion !== undefined ? { version: input.expectedVersion } : {}),
        },
        data: {
          state: input.to,
          version: { increment: 1 },
          ...(input.to === "OPEN" && !ctx.cycle.state.startsWith("OPEN") ? { openedAt: new Date() } : {}),
          ...(input.to === "COMPLETED" ? { closedAt: new Date() } : {}),
          ...(input.to === "FINALISATION" ? { finalisedAt: new Date() } : {}),
        },
      })
      if (result.count === 0) return false

      await auditRecruitmentTx(tx, {
        eventType: "cycle.transition",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: input.cycleId,
        previousState: { state: from },
        newState: { state: input.to },
        reason: input.reason ?? null,
        meta: { implicit: ctx.implicit },
      })
      return true
    })

    if (!applied) {
      return { ok: false, error: "This cycle changed state elsewhere. Reload and try again." }
    }

    revalidatePath("/admin/recruitment", "layout")
    revalidatePath("/recruitment", "layout")
    return { ok: true }
  } catch (err) {
    return denied(err)
  }
}

// ---------------------------------------------------------------------------
// Recruit a selected candidate into the society
// ---------------------------------------------------------------------------

export type RecruitResult =
  | { ok: true; userId: string; idempotent: boolean }
  | { ok: false; error: string }

// Finalising (result = SELECTED) and joining the society are deliberately separate
// actions; this is the second one. Safe to retry: the candidate's recruitedUserId
// is unique and checked first, so a double-click cannot create two memberships.
//
// Recruitment creates an ordinary member. Author onboarding is deliberately a
// separate later workflow.
export async function recruitCandidate(input: {
  candidateId: string
  societyRole: "MEMBER"
  designation?: string
}): Promise<RecruitResult> {
  const parsed = recruitCandidateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." }
  }
  const data = parsed.data

  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { id: data.candidateId },
    select: {
      id: true,
      cycleId: true,
      fullName: true,
      email: true,
      result: true,
      version: true,
      recruitedUserId: true,
      cycle: { select: { config: true } },
    },
  })
  if (!candidate) return { ok: false, error: "Candidate not found." }

  try {
    const ctx = await requireRecruitmentAction(candidate.cycleId, "candidate.recruit")

    // Already done: return the existing membership rather than making another.
    if (candidate.recruitedUserId) {
      return { ok: true, userId: candidate.recruitedUserId, idempotent: true }
    }
    if (candidate.result !== "SELECTED") {
      return { ok: false, error: "Only a selected candidate can be added to the society." }
    }

    // The cycle decides which roles it hands out.
    const config = parseCycleConfig(candidate.cycle.config)
    if (!config.societyRoles.includes(data.societyRole)) {
      return { ok: false, error: "That society role is not offered by this recruitment cycle." }
    }

    const email = candidate.email.trim().toLowerCase()
    const requestId = newRequestId()

    const result = await prisma.$transaction(async (tx) => {
      // Handle a candidate who already has an account (a delegate, an author, or
      // someone invited earlier). Link rather than duplicate.
      const existingUser = await tx.user.findUnique({
        where: { email },
        select: { id: true, role: true, name: true },
      })

      let userId: string
      let createdUser = false
      let previousRole: Role | null = null

      if (existingUser) {
        userId = existingUser.id
        previousRole = existingUser.role
        // Never demote an existing ADMIN/MAINTAINER by recruiting them, and never
        // promote anyone into those roles here.
        const keepsPrivilege = existingUser.role === "ADMIN" || existingUser.role === "MAINTAINER"
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(keepsPrivilege ? {} : { role: data.societyRole }),
            name: existingUser.name ?? candidate.fullName,
          },
        })
      } else {
        const created = await tx.user.create({
          data: { email, name: candidate.fullName, role: data.societyRole },
          select: { id: true },
        })
        userId = created.id
        createdUser = true
      }

      // Optional public roster row.
      let memberId: string | null = null
      if (data.designation) {
        const member = await tx.member.create({
          data: { name: candidate.fullName, designation: data.designation.trim(), isActive: true },
          select: { id: true },
        })
        memberId = member.id
      }

      // Conditional on recruitedUserId still being null: two admins clicking at
      // once means one writes and the other's update matches zero rows.
      const claimed = await tx.recruitmentCandidate.updateMany({
        where: { id: candidate.id, recruitedUserId: null },
        data: {
          recruitedUserId: userId,
          recruitedById: ctx.userId,
          recruitedAt: new Date(),
          societyRole: data.societyRole,
          memberId,
          version: { increment: 1 },
        },
      })
      if (claimed.count === 0) {
        // Roll the whole transaction back: including the user and member rows,
        // so the losing request leaves nothing behind.
        throw new AlreadyRecruited()
      }

      await auditRecruitmentTx(tx, {
        eventType: "candidate.recruit",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: candidate.cycleId,
        candidateId: candidate.id,
        previousState: { recruitedUserId: null, existingAccount: !createdUser, previousRole },
        newState: { recruitedUserId: userId, societyRole: data.societyRole, memberId },
        reason: data.designation
          ? `Added to the society as ${data.societyRole} with roster designation "${data.designation.trim()}".`
          : `Added to the society as ${data.societyRole}.`,
        meta: { createdUser, email, implicit: ctx.implicit },
        requestId,
      })

      return { userId, createdUser }
    })

    // Mirrors the generic trail used by /admin/logs, so a role change made by
    // recruitment is visible next to ones made in Users.
    await audit(ctx.email, "recruitment.recruitCandidate", "User", result.userId, {
      candidateId: candidate.id,
      societyRole: data.societyRole,
      createdUser: result.createdUser,
    })

    revalidatePath("/admin/recruitment", "layout")
    revalidatePath("/admin/users")
    revalidatePath("/recruitment", "layout")
    return { ok: true, userId: result.userId, idempotent: false }
  } catch (err) {
    if (err instanceof AlreadyRecruited) {
      const fresh = await prisma.recruitmentCandidate.findUnique({
        where: { id: candidate.id },
        select: { recruitedUserId: true },
      })
      if (fresh?.recruitedUserId) {
        return { ok: true, userId: fresh.recruitedUserId, idempotent: true }
      }
      return { ok: false, error: "Another administrator recruited this candidate first." }
    }
    if (isUniqueViolation(err)) {
      return { ok: false, error: "That candidate appears to already be a member. Reload to check." }
    }
    const d = denied(err)
    return { ok: false, error: d.ok ? "Unknown error." : d.error }
  }
}

class AlreadyRecruited extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002"
  )
}
