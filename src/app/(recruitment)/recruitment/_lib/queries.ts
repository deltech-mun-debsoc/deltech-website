import { prisma } from "@/lib/prisma"
import { displayState, type SessionSnapshot } from "@/lib/recruitment/session"
import type { RecruitmentContext } from "@/lib/recruitment/authz"
import { visibleGroupIds } from "@/lib/recruitment/authz"
import type { TimerSession } from "../../_components/session-timer"

// Read models for the recruitment screens. Scoping lives here rather than in the
// pages so a JC can never be shown a group they were not put on, whichever screen
// they arrive from.

export interface GroupListItem {
  id: string
  kind: "GD" | "PI"
  title: string
  state: string
  scheduledAt: Date | null
  candidateCount: number
  evaluationCount: number
  staff: { name: string | null; email: string; role: string; canEvaluate: boolean }[]
  session: (TimerSession & { id: string; version: number; attempt: number; controllerId: string | null }) | null
  displayState: string
}

export async function listGroups(
  ctx: RecruitmentContext,
  kind: "GD" | "PI",
): Promise<GroupListItem[]> {
  const scoped = await visibleGroupIds(ctx)
  const serverNow = new Date()

  const groups = await prisma.recruitmentGroup.findMany({
    where: {
      cycleId: ctx.cycle.id,
      kind,
      state: { not: "ARCHIVED" },
      // `null` means unrestricted (maintainer/admin); an array restricts a JC to
      // their own assignments.
      ...(scoped ? { id: { in: scoped } } : {}),
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    include: {
      _count: { select: { members: true } },
      staff: {
        include: { member: { include: { user: { select: { name: true, email: true } } } } },
      },
      sessions: { orderBy: { attempt: "desc" }, take: 1, include: { _count: { select: { evaluations: true } } } },
    },
  })

  return groups.map((g) => {
    const s = g.sessions[0]
    const snapshot: SessionSnapshot | null = s
      ? {
          id: s.id,
          state: s.state,
          version: s.version,
          controllerId: s.controllerId,
          controlExpiresAt: s.controlExpiresAt,
          startedAt: s.startedAt,
          pausedAt: s.pausedAt,
          endedAt: s.endedAt,
          pausedMs: s.pausedMs,
          lastActivityAt: s.lastActivityAt,
        }
      : null

    return {
      id: g.id,
      kind: g.kind,
      title: g.title,
      state: g.state,
      scheduledAt: g.scheduledAt,
      candidateCount: g._count.members,
      evaluationCount: s?._count.evaluations ?? 0,
      staff: g.staff.map((a) => ({
        name: a.member.user.name,
        email: a.member.user.email,
        role: a.role,
        canEvaluate: a.canEvaluate,
      })),
      session: s
        ? {
            id: s.id,
            version: s.version,
            attempt: s.attempt,
            controllerId: s.controllerId,
            state: s.state,
            startedAt: s.startedAt?.toISOString() ?? null,
            pausedAt: s.pausedAt?.toISOString() ?? null,
            endedAt: s.endedAt?.toISOString() ?? null,
            pausedMs: s.pausedMs,
            lastActivityAt: s.lastActivityAt?.toISOString() ?? null,
            plannedSeconds: s.plannedSeconds,
            serverNow: serverNow.toISOString(),
          }
        : null,
      displayState: snapshot ? displayState(snapshot, serverNow) : "NOT_STARTED",
    }
  })
}

// The group console: roster, each candidate's own evaluation state, and the session.
export async function getGroupConsole(ctx: RecruitmentContext, groupId: string) {
  const serverNow = new Date()

  const group = await prisma.recruitmentGroup.findFirst({
    where: { id: groupId, cycleId: ctx.cycle.id },
    include: {
      members: {
        orderBy: [{ seat: "asc" }, { createdAt: "asc" }],
        include: {
          candidate: {
            select: {
              id: true,
              fullName: true,
              email: true,
              year: true,
              branch: true,
              stage: true,
              result: true,
              version: true,
              gdRequired: true,
            },
          },
        },
      },
      staff: {
        include: { member: { include: { user: { select: { id: true, name: true, email: true } } } } },
      },
      sessions: { orderBy: { attempt: "desc" } },
    },
  })
  if (!group) return null

  const session = group.sessions[0] ?? null

  const previousGdSessions =
    group.kind === "GD"
      ? await prisma.recruitmentSession.findMany({
          where: {
            cycleId: group.cycleId,
            kind: "GD",
            state: "COMPLETED",
            group: {
              members: {
                some: {
                  candidateId: { in: group.members.map((member) => member.candidateId) },
                  // Reassignment changes attendance but preserves joinedAt.
                  joinedAt: { not: null },
                },
              },
            },
          },
          select: {
            group: {
              select: {
                members: {
                  where: {
                    candidateId: { in: group.members.map((member) => member.candidateId) },
                    joinedAt: { not: null },
                  },
                  select: { candidateId: true },
                },
              },
            },
          },
        })
      : []
  const previousGdByCandidate = new Map<string, number>()
  for (const attempt of previousGdSessions) {
    for (const member of attempt.group.members) {
      previousGdByCandidate.set(
        member.candidateId,
        (previousGdByCandidate.get(member.candidateId) ?? 0) + 1,
      )
    }
  }

  // Every evaluation for this group's candidates in this round. A JC sees only
  // their own, so panels stay independent.
  const evaluations = await prisma.recruitmentEvaluation.findMany({
    where: {
      candidateId: { in: group.members.map((m) => m.candidateId) },
      kind: group.kind,
      state: { in: ["DRAFT", "SUBMITTED"] },
      ...(ctx.role === "JC" ? { evaluatorId: ctx.userId } : {}),
    },
    select: {
      id: true,
      candidateId: true,
      evaluatorId: true,
      evaluatorRole: true,
      scores: true,
      overall: true,
      remarks: true,
      recommendation: true,
      state: true,
      version: true,
      submittedAt: true,
    },
  })

  const evaluatorIds = [...new Set(evaluations.map((e) => e.evaluatorId))]
  const evaluators = await prisma.user.findMany({
    where: { id: { in: evaluatorIds } },
    select: { id: true, name: true, email: true },
  })
  const evaluatorById = new Map(evaluators.map((u) => [u.id, u]))

  const snapshot: SessionSnapshot | null = session
    ? {
        id: session.id,
        state: session.state,
        version: session.version,
        controllerId: session.controllerId,
        controlExpiresAt: session.controlExpiresAt,
        startedAt: session.startedAt,
        pausedAt: session.pausedAt,
        endedAt: session.endedAt,
        pausedMs: session.pausedMs,
        lastActivityAt: session.lastActivityAt,
      }
    : null

  return {
    group: {
      id: group.id,
      kind: group.kind,
      title: group.title,
      state: group.state,
      scheduledAt: group.scheduledAt,
      notes: group.notes,
    },
    session: session
      ? {
          id: session.id,
          version: session.version,
          attempt: session.attempt,
          state: session.state,
          controllerId: session.controllerId,
          startedAt: session.startedAt?.toISOString() ?? null,
          pausedAt: session.pausedAt?.toISOString() ?? null,
          endedAt: session.endedAt?.toISOString() ?? null,
          pausedMs: session.pausedMs,
          lastActivityAt: session.lastActivityAt?.toISOString() ?? null,
          plannedSeconds: session.plannedSeconds,
          serverNow: serverNow.toISOString(),
        }
      : null,
    displayState: snapshot ? displayState(snapshot, serverNow) : "NOT_STARTED",
    // Earlier attempts, so a reopened session still shows what the first one did.
    previousAttempts: group.sessions.slice(1).map((s) => ({
      id: s.id,
      attempt: s.attempt,
      state: s.state,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      pausedMs: s.pausedMs,
      reopenReason: s.reopenReason,
    })),
    members: group.members.map((m) => ({
      id: m.id,
      attendance: m.attendance,
      joinedAt: m.joinedAt,
      previousGdAttempts:
        group.kind === "GD"
          ? previousGdByCandidate.get(m.candidateId) ?? 0
          : 0,
      candidate: m.candidate,
      evaluations: evaluations
        .filter((e) => e.candidateId === m.candidateId)
        .map((e) => ({
          ...e,
          scores: (e.scores ?? {}) as Record<string, number>,
          evaluatorName: evaluatorById.get(e.evaluatorId)?.name ?? null,
          evaluatorEmail: evaluatorById.get(e.evaluatorId)?.email ?? null,
          isMine: e.evaluatorId === ctx.userId,
          submittedAt: e.submittedAt?.toISOString() ?? null,
        })),
    })),
    staff: group.staff.map((a) => ({
      userId: a.member.user.id,
      name: a.member.user.name,
      email: a.member.user.email,
      role: a.role,
      canEvaluate: a.canEvaluate,
    })),
    serverNow: serverNow.toISOString(),
  }
}

// Everything assigned to this person, for the "my desk" landing.
export async function getMyDesk(ctx: RecruitmentContext) {
  const scoped = await visibleGroupIds(ctx)
  const serverNow = new Date()

  const sessions = await prisma.recruitmentSession.findMany({
    where: {
      cycleId: ctx.cycle.id,
      ...(scoped ? { groupId: { in: scoped } } : {}),
      state: { in: ["NOT_STARTED", "ACTIVE", "PAUSED"] },
    },
    orderBy: [{ state: "asc" }, { scheduledAt: "asc" }],
    include: {
      group: {
        select: {
          id: true,
          title: true,
          kind: true,
          _count: { select: { members: true } },
        },
      },
      _count: { select: { evaluations: true } },
    },
  })

  // Candidates this person still owes a score for: in a group they staff, in a
  // finished-or-running session, with no submitted evaluation from them.
  const owed = await prisma.recruitmentGroupMember.findMany({
    where: {
      attendance: "PRESENT",
      group: {
        cycleId: ctx.cycle.id,
        ...(scoped ? { id: { in: scoped } } : {}),
        sessions: { some: { state: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } } },
        // Only where this person is actually allowed to score.
        staff: { some: { member: { userId: ctx.userId, isActive: true }, canEvaluate: true } },
      },
      candidate: { evaluations: { none: { evaluatorId: ctx.userId, state: "SUBMITTED" } } },
    },
    take: 25,
    include: {
      group: { select: { id: true, title: true, kind: true } },
      candidate: { select: { id: true, fullName: true, stage: true } },
    },
  })

  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      groupId: s.group.id,
      groupTitle: s.group.title,
      kind: s.group.kind,
      state: s.state,
      candidateCount: s.group._count.members,
      evaluationCount: s._count.evaluations,
      controllerId: s.controllerId,
      timer: {
        state: s.state,
        startedAt: s.startedAt?.toISOString() ?? null,
        pausedAt: s.pausedAt?.toISOString() ?? null,
        endedAt: s.endedAt?.toISOString() ?? null,
        pausedMs: s.pausedMs,
        lastActivityAt: s.lastActivityAt?.toISOString() ?? null,
        plannedSeconds: s.plannedSeconds,
        serverNow: serverNow.toISOString(),
      } satisfies TimerSession,
      displayState: displayState(
        {
          id: s.id,
          state: s.state,
          version: s.version,
          controllerId: s.controllerId,
          controlExpiresAt: s.controlExpiresAt,
          startedAt: s.startedAt,
          pausedAt: s.pausedAt,
          endedAt: s.endedAt,
          pausedMs: s.pausedMs,
          lastActivityAt: s.lastActivityAt,
        },
        serverNow,
      ),
    })),
    owed: owed.map((m) => ({
      groupMemberId: m.id,
      groupId: m.group.id,
      groupTitle: m.group.title,
      kind: m.group.kind,
      candidateId: m.candidate.id,
      candidateName: m.candidate.fullName,
      stage: m.candidate.stage,
    })),
  }
}
