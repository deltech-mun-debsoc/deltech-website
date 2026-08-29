"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { RecruitmentDenied, requireGroupAccess, requireRecruitmentAction } from "@/lib/recruitment/authz"
import { auditRecruitmentTx, newRequestId } from "@/lib/recruitment/audit"
import { createGroupSchema, parseCycleConfig } from "@/lib/schemas/recruitment"

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
  console.error("[recruitment/group]", err)
  return { ok: false, error: "Something went wrong. Reload and try again." }
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

    revalidatePath("/recruitment")
    return { ok: true, groupId: group.id }
  } catch (err) {
    return denied(err)
  }
}

// Move a candidate between groups. The old membership is marked REASSIGNED rather
// than deleted, which both preserves history and frees the unique-index slot.
export async function reassignCandidate(input: {
  candidateId: string
  fromGroupId: string
  toGroupId: string
  reason?: string
}): Promise<GroupResult> {
  try {
    const { ctx } = await requireGroupAccess(input.toGroupId, "group.assignCandidates")

    const [fromGroup, toGroup, membership] = await Promise.all([
      prisma.recruitmentGroup.findUnique({
        where: { id: input.fromGroupId },
        select: { id: true, cycleId: true, kind: true },
      }),
      prisma.recruitmentGroup.findUnique({
        where: { id: input.toGroupId },
        select: { id: true, cycleId: true, kind: true },
      }),
      prisma.recruitmentGroupMember.findUnique({
        where: { groupId_candidateId: { groupId: input.fromGroupId, candidateId: input.candidateId } },
        select: { id: true, attendance: true },
      }),
    ])

    if (!fromGroup || !toGroup) return { ok: false, error: "Group not found." }
    if (!membership) return { ok: false, error: "That candidate is not in the source group." }
    if (fromGroup.cycleId !== toGroup.cycleId) {
      return { ok: false, error: "Groups belong to different recruitment cycles." }
    }
    if (fromGroup.kind !== toGroup.kind) {
      return { ok: false, error: "A GD seat cannot be moved into a PI group." }
    }
    if (fromGroup.id === toGroup.id) return { ok: true, groupId: toGroup.id } // idempotent

    // Refuse while the candidate is mid-session: moving them would strand an
    // in-flight evaluation against the old group.
    const locked = await prisma.recruitmentCandidateLock.count({ where: { candidateId: input.candidateId } })
    if (locked > 0) {
      return { ok: false, error: "This candidate is in a live session. End it before reassigning." }
    }

    await prisma.$transaction(async (tx) => {
      await tx.recruitmentGroupMember.update({
        where: { id: membership.id },
        data: { attendance: "REASSIGNED" },
      })
      await tx.recruitmentGroupMember.create({
        data: {
          groupId: toGroup.id,
          candidateId: input.candidateId,
          kind: toGroup.kind,
          addedById: ctx.userId,
        },
      })
      await auditRecruitmentTx(tx, {
        eventType: "candidate.reassign",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: toGroup.cycleId,
        candidateId: input.candidateId,
        groupId: toGroup.id,
        previousState: { groupId: fromGroup.id },
        newState: { groupId: toGroup.id },
        reason: input.reason ?? null,
        meta: { implicit: ctx.implicit },
      })
    })

    revalidatePath("/recruitment")
    return { ok: true, groupId: toGroup.id }
  } catch (err) {
    return denied(err)
  }
}

// Add candidates to an existing draft/ready group.
export async function addCandidatesToGroup(input: {
  groupId: string
  candidateIds: string[]
}): Promise<GroupResult> {
  if (input.candidateIds.length === 0) return { ok: false, error: "Pick at least one candidate." }

  try {
    const { ctx } = await requireGroupAccess(input.groupId, "group.assignCandidates")

    const group = await prisma.recruitmentGroup.findUnique({
      where: { id: input.groupId },
      select: { id: true, cycleId: true, kind: true, state: true },
    })
    if (!group) return { ok: false, error: "Group not found." }

    const candidates = await prisma.recruitmentCandidate.findMany({
      where: { id: { in: input.candidateIds }, cycleId: group.cycleId },
      select: { id: true },
    })
    if (candidates.length !== input.candidateIds.length) {
      return { ok: false, error: "Some of those candidates are not in this recruitment cycle." }
    }

    await prisma.$transaction(async (tx) => {
      for (const c of candidates) {
        // Upsert so re-adding someone already on the roster is a no-op rather than
        // a unique-constraint error on a double-click.
        await tx.recruitmentGroupMember.upsert({
          where: { groupId_candidateId: { groupId: group.id, candidateId: c.id } },
          create: {
            groupId: group.id,
            candidateId: c.id,
            kind: group.kind,
            addedById: ctx.userId,
          },
          update: { attendance: "PRESENT" },
        })
      }
      await tx.recruitmentCandidate.updateMany({
        where: {
          id: { in: candidates.map((c) => c.id) },
          stage: group.kind === "GD" ? { in: ["INTAKE"] } : { in: ["GD_COMPLETE", "GD_BYPASSED"] },
        },
        data: { stage: group.kind === "GD" ? "GD_PENDING" : "PI_PENDING" },
      })
      await auditRecruitmentTx(tx, {
        eventType: "group.assignCandidates",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: group.cycleId,
        groupId: group.id,
        newState: { added: candidates.length },
        meta: { candidateIds: candidates.map((c) => c.id), implicit: ctx.implicit },
      })
    })

    revalidatePath("/recruitment")
    return { ok: true, groupId: group.id }
  } catch (err) {
    return denied(err)
  }
}

export async function assignGroupStaff(input: {
  groupId: string
  staff: { memberId: string; canEvaluate: boolean }[]
}): Promise<GroupResult> {
  try {
    const { ctx } = await requireGroupAccess(input.groupId, "group.assignStaff")

    const group = await prisma.recruitmentGroup.findUnique({
      where: { id: input.groupId },
      select: { id: true, cycleId: true },
    })
    if (!group) return { ok: false, error: "Group not found." }

    const members = await prisma.recruitmentMember.findMany({
      where: { id: { in: input.staff.map((s) => s.memberId) }, cycleId: group.cycleId, isActive: true },
      select: { id: true, role: true },
    })
    if (members.length !== input.staff.length) {
      return { ok: false, error: "Some of those staff members are not active on this cycle." }
    }
    const byId = new Map(members.map((m) => [m.id, m]))

    await prisma.$transaction(async (tx) => {
      for (const s of input.staff) {
        const member = byId.get(s.memberId)!
        await tx.recruitmentStaffAssignment.upsert({
          where: { groupId_memberId: { groupId: group.id, memberId: s.memberId } },
          create: {
            groupId: group.id,
            memberId: s.memberId,
            role: member.role,
            canEvaluate: member.role === "JC" ? s.canEvaluate : true,
            assignedById: ctx.userId,
          },
          update: {
            role: member.role,
            canEvaluate: member.role === "JC" ? s.canEvaluate : true,
          },
        })
      }
      await auditRecruitmentTx(tx, {
        eventType: "group.assignStaff",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: group.cycleId,
        groupId: group.id,
        newState: { staff: input.staff },
        meta: { implicit: ctx.implicit },
      })
    })

    revalidatePath("/recruitment")
    return { ok: true, groupId: group.id }
  } catch (err) {
    return denied(err)
  }
}

// Groups are archived, never deleted: sessions, evaluations and audit rows point
// at them.
export async function archiveGroup(input: { groupId: string }): Promise<GroupResult> {
  try {
    const { ctx } = await requireGroupAccess(input.groupId, "group.archive")

    const group = await prisma.recruitmentGroup.findUnique({
      where: { id: input.groupId },
      select: { id: true, cycleId: true, state: true, sessions: { select: { state: true } } },
    })
    if (!group) return { ok: false, error: "Group not found." }
    if (group.state === "ARCHIVED") return { ok: true, groupId: group.id } // idempotent
    if (group.sessions.some((s) => s.state === "ACTIVE" || s.state === "PAUSED")) {
      return { ok: false, error: "This group has a live session. End it before archiving." }
    }

    await prisma.$transaction(async (tx) => {
      await tx.recruitmentGroup.update({
        where: { id: group.id },
        data: { state: "ARCHIVED", version: { increment: 1 } },
      })
      await auditRecruitmentTx(tx, {
        eventType: "group.archive",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: group.cycleId,
        groupId: group.id,
        previousState: { state: group.state },
        newState: { state: "ARCHIVED" },
        meta: { implicit: ctx.implicit },
      })
    })

    revalidatePath("/recruitment")
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
