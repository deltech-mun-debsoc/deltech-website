"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { RecruitmentDenied, requireGroupAccess, requireRecruitmentAction } from "@/lib/recruitment/authz"
import { auditRecruitmentTx, newRequestId } from "@/lib/recruitment/audit"
import { createGroupSchema, parseCycleConfig } from "@/lib/schemas/recruitment"
import {
  isSchemaDrift,
  SCHEMA_DRIFT_MESSAGE,
  failureRef,
  unexpectedFailureMessage,
} from "@/lib/prisma-errors"

// GD / PI group management. A group is a draft roster plus its staff; the session
// that runs it is a separate row (see session-actions.ts) so a group can be
// re-run without losing the previous attempt's timings or scores.

export type GroupResult = { ok: true; groupId: string } | { ok: false; error: string }

function denied(err: unknown): GroupResult {
  if (err instanceof RecruitmentDenied) {
    return {
      ok: false,
      error:
        err.detail === "cycle-state"
          ? "This recruitment cycle's current state does not allow that."
          : err.detail === "not-assigned"
            ? "You are not assigned to this group."
            : "You are not permitted to do that.",
    }
  }
  if (isUniqueViolation(err)) {
    return {
      ok: false,
      error: "One of those candidates already has a live seat for this round. Reassign them first.",
    }
  }
  // A migration merged but never applied leaves the code writing values the
  // database does not have. That is a skipped deploy step, not a bug in
  // here, and saying so is the difference between a two-minute fix and a hunt.
  if (isSchemaDrift(err)) return { ok: false, error: SCHEMA_DRIFT_MESSAGE }
  // A reference the operator can read off the screen and quote. It is logged
  // beside the exception, so diagnosing the next one is a grep rather than a hunt.
  const ref = failureRef(err)
  console.error("[recruitment/group]", ref.ref, ref.code ?? "-", err)
  return { ok: false, error: unexpectedFailureMessage(ref) }
}

export async function createGroup(input: {
  cycleId: string
  kind: "GD" | "PI"
  title: string
  scheduledAt?: Date | null
  candidateIds?: string[]
  staff?: { memberId: string; canEvaluate: boolean }[]
  notes?: string
}): Promise<GroupResult> {
  const parsed = createGroupSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid group." }
  }
  const data = parsed.data

  try {
    const ctx = await requireRecruitmentAction(input.cycleId, "group.create")
    const config = parseCycleConfig(ctx.cycle.config)
    const requestId = newRequestId()

    // Candidates must belong to this cycle, never trust ids from the client.
    const candidates = await prisma.recruitmentCandidate.findMany({
      where: { id: { in: data.candidateIds }, cycleId: input.cycleId },
      select: { id: true, fullName: true, stage: true },
    })
    if (candidates.length !== data.candidateIds.length) {
      return { ok: false, error: "Some of those candidates are not in this recruitment cycle." }
    }

    // Staff must be active members of this cycle.
    const members = await prisma.recruitmentMember.findMany({
      where: { id: { in: data.staff.map((s) => s.memberId) }, cycleId: input.cycleId, isActive: true },
      select: { id: true, role: true, userId: true },
    })
    if (members.length !== data.staff.length) {
      return { ok: false, error: "Some of those staff members are not active on this cycle." }
    }

    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.recruitmentGroup.create({
        data: {
          cycleId: input.cycleId,
          kind: data.kind,
          title: data.title.trim(),
          scheduledAt: data.scheduledAt ?? null,
          notes: data.notes?.trim() || null,
          state: "DRAFT",
          createdById: ctx.userId,
        },
        select: { id: true },
      })

      if (candidates.length > 0) {
        // The partial unique index refuses a candidate who already holds a live
        // seat for this round, so this throws rather than double-booking them.
        await tx.recruitmentGroupMember.createMany({
          data: candidates.map((c) => ({
            groupId: created.id,
            candidateId: c.id,
            kind: data.kind,
            addedById: ctx.userId,
          })),
        })
        // Queue them for the round.
        await tx.recruitmentCandidate.updateMany({
          where: {
            id: { in: candidates.map((c) => c.id) },
            stage: data.kind === "GD" ? { in: ["INTAKE"] } : { in: ["GD_COMPLETE", "GD_BYPASSED"] },
          },
          data: { stage: data.kind === "GD" ? "GD_PENDING" : "PI_PENDING" },
        })
      }

      if (members.length > 0) {
        const byId = new Map(members.map((m) => [m.id, m]))
        await tx.recruitmentStaffAssignment.createMany({
          data: data.staff.map((s) => {
            const member = byId.get(s.memberId)!
            return {
              groupId: created.id,
              memberId: s.memberId,
              // Denormalised so an evaluation is attributed to the role held at
              // the time, even if the person's role changes later.
              role: member.role,
              // A maintainer always evaluates; a JC only where explicitly allowed.
              canEvaluate: member.role === "JC" ? s.canEvaluate : true,
              assignedById: ctx.userId,
            }
          }),
        })
      }

      // Prefill the timer target from the cycle's configured length.
      await tx.recruitmentSession.create({
        data: {
          cycleId: input.cycleId,
          groupId: created.id,
          kind: data.kind,
          attempt: 1,
          state: "NOT_STARTED",
          scheduledAt: data.scheduledAt ?? null,
          plannedSeconds:
            data.kind === "GD" ? config.stages.gdPlannedSeconds : config.stages.piPlannedSeconds,
        },
      })

      await auditRecruitmentTx(tx, {
        eventType: "group.create",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: input.cycleId,
        groupId: created.id,
        newState: {
          kind: data.kind,
          title: data.title.trim(),
          candidates: candidates.length,
          staff: data.staff.length,
        },
        meta: { implicit: ctx.implicit },
        requestId,
      })

      return created
    })

    revalidatePath("/recruitment", "layout")
    return { ok: true, groupId: group.id }
  } catch (err) {
    return denied(err)
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002"
  )
}
