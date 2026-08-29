// The candidate dossier: the complete, traceable handoff a PI evaluator receives.
//
// The requirement this file exists to satisfy: the handoff must stay valid even
// when the candidate never did a GD. A direct-to-PI candidate shows "GD
// intentionally bypassed", with actor and reason, rather than empty panels or a
// broken query. `gdStatus` below is what makes that distinction explicit instead
// of leaving the UI to guess from absent rows.

import { prisma } from "@/lib/prisma"
import { elapsedMs, type SessionSnapshot } from "./session"
import { criteriaFor, parseCycleConfig, type EvaluationCriterion } from "@/lib/schemas/recruitment"
import type { RecruitmentRoleName } from "./permissions"

export interface DossierEvaluation {
  id: string
  kind: "GD" | "PI"
  evaluatorId: string
  evaluatorName: string | null
  evaluatorEmail: string | null
  evaluatorRole: RecruitmentRoleName
  scores: Record<string, number>
  overall: number | null
  remarks: string | null
  recommendation: string | null
  state: string
  version: number
  supersedesId: string | null
  overrideReason: string | null
  submittedAt: Date | null
  updatedAt: Date
}

export interface DossierSession {
  id: string
  kind: "GD" | "PI"
  attempt: number
  groupId: string
  groupTitle: string
  state: string
  scheduledAt: Date | null
  startedAt: Date | null
  endedAt: Date | null
  pausedMs: number
  // Exact duration, computed from server timestamps.
  durationMs: number
  attendance: string | null
  staff: { name: string | null; email: string; role: string; canEvaluate: boolean }[]
}

export interface DossierHandoff {
  id: string
  fromStage: string
  toStage: string
  bypass: boolean
  reason: string | null
  actorId: string
  actorName: string | null
  actorRole: string
  sessionId: string | null
  reversedAt: Date | null
  reverseReason: string | null
  createdAt: Date
}

// Why there is (or isn't) GD data. An explicit union beats inferring from an
// empty array, which is exactly the ambiguity the spec asks us to remove.
export type GdStatus =
  | { kind: "completed" }
  | { kind: "bypassed"; reason: string | null; actorName: string | null; actorRole: string; at: Date }
  | { kind: "not-required" }
  | { kind: "pending" }

export interface CandidateDossier {
  candidate: {
    id: string
    cycleId: string
    fullName: string
    email: string
    phone: string | null
    year: string | null
    branch: string | null
    stage: string
    result: string
    gdRequired: boolean
    piRequired: boolean
    version: number
    manualEditedFields: string[]
    createdAt: Date
    updatedAt: Date
    recruitedUserId: string | null
    recruitedAt: Date | null
    societyRole: string | null
  }
  // The raw imported form response, verbatim.
  formResponse: Record<string, string>
  importProvenance: {
    sourceSheetKey: string | null
    sourceRowKey: string | null
    importedAt: Date | null
    importedById: string | null
  }
  gdStatus: GdStatus
  gdSessions: DossierSession[]
  piSessions: DossierSession[]
  gdEvaluations: DossierEvaluation[]
  piEvaluations: DossierEvaluation[]
  // Aggregates, kept distinct from any individual score and from the final call.
  gdAggregate: number | null
  piAggregate: number | null
  // Every stage move, bypass and override in order.
  history: DossierHandoff[]
  // Previous PI attempts, surfaced separately because an evaluator needs to know
  // they are not the first.
  previousPiAttempts: number
  gdCriteria: EvaluationCriterion[]
  piCriteria: EvaluationCriterion[]
  serverNow: Date
}

function toScores(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

function toFormResponse(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
      .map(([k, v]) => [k, String(v)]),
  )
}

// The aggregated score: mean of SUBMITTED, non-superseded evaluations. Deliberately
// computed rather than stored, so revising one evaluator's score cannot leave a
// stale aggregate behind.
export function aggregateScore(evaluations: DossierEvaluation[]): number | null {
  const live = evaluations.filter((e) => e.state === "SUBMITTED" && e.overall !== null)
  if (live.length === 0) return null
  const sum = live.reduce((acc, e) => acc + (e.overall ?? 0), 0)
  return Number((sum / live.length).toFixed(2))
}

export async function getCandidateDossier(
  candidateId: string,
  // A JC may only see their own evaluations, so panels stay independent.
  options: { viewerId?: string; canViewOthers?: boolean } = {},
): Promise<CandidateDossier | null> {
  const serverNow = new Date()

  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      cycleId: true,
      fullName: true,
      email: true,
      phone: true,
      year: true,
      branch: true,
      stage: true,
      result: true,
      gdRequired: true,
      piRequired: true,
      version: true,
      manualEditedFields: true,
      formAnswers: true,
      sourceSheetKey: true,
      sourceRowKey: true,
      importedAt: true,
      importedById: true,
      createdAt: true,
      updatedAt: true,
      recruitedUserId: true,
      recruitedAt: true,
      societyRole: true,
      cycle: { select: { config: true } },
      groupMemberships: {
        select: {
          kind: true,
          attendance: true,
          group: {
            select: {
              id: true,
              title: true,
              sessions: {
                orderBy: { attempt: "asc" },
                select: {
                  id: true,
                  kind: true,
                  attempt: true,
                  state: true,
                  scheduledAt: true,
                  startedAt: true,
                  pausedAt: true,
                  endedAt: true,
                  pausedMs: true,
                  controllerId: true,
                  controlExpiresAt: true,
                  lastActivityAt: true,
                  version: true,
                },
              },
              staff: {
                select: {
                  role: true,
                  canEvaluate: true,
                  member: { select: { user: { select: { name: true, email: true } } } },
                },
              },
            },
          },
        },
      },
      evaluations: {
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          kind: true,
          evaluatorId: true,
          evaluatorRole: true,
          scores: true,
          overall: true,
          remarks: true,
          recommendation: true,
          state: true,
          version: true,
          supersedesId: true,
          overrideReason: true,
          submittedAt: true,
          updatedAt: true,
          createdAt: true,
        },
      },
      handoffs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fromStage: true,
          toStage: true,
          bypass: true,
          reason: true,
          actorId: true,
          actorRole: true,
          sessionId: true,
          reversedAt: true,
          reverseReason: true,
          createdAt: true,
        },
      },
    },
  })
  if (!candidate) return null

  const config = parseCycleConfig(candidate.cycle.config)

  // Resolve evaluator identities in one query rather than N.
  const evaluatorIds = [...new Set(candidate.evaluations.map((e) => e.evaluatorId))]
  const actorIds = [...new Set(candidate.handoffs.map((h) => h.actorId))]
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set([...evaluatorIds, ...actorIds])] } },
    select: { id: true, name: true, email: true },
  })
  const userById = new Map(users.map((u) => [u.id, u]))

  const visible = candidate.evaluations.filter(
    (e) => options.canViewOthers !== false || e.evaluatorId === options.viewerId,
  )

  const mapEvaluation = (e: (typeof candidate.evaluations)[number]): DossierEvaluation => ({
    id: e.id,
    kind: e.kind,
    evaluatorId: e.evaluatorId,
    evaluatorName: userById.get(e.evaluatorId)?.name ?? null,
    evaluatorEmail: userById.get(e.evaluatorId)?.email ?? null,
    evaluatorRole: e.evaluatorRole,
    scores: toScores(e.scores),
    overall: e.overall,
    remarks: e.remarks,
    recommendation: e.recommendation,
    state: e.state,
    version: e.version,
    supersedesId: e.supersedesId,
    overrideReason: e.overrideReason,
    submittedAt: e.submittedAt,
    updatedAt: e.updatedAt,
  })

  const gdEvaluations = visible.filter((e) => e.kind === "GD").map(mapEvaluation)
  const piEvaluations = visible.filter((e) => e.kind === "PI").map(mapEvaluation)

  const sessionsFor = (kind: "GD" | "PI"): DossierSession[] =>
    candidate.groupMemberships
      .filter((m) => m.kind === kind)
      .flatMap((m) =>
        m.group.sessions.map((s) => {
          const snapshot: SessionSnapshot = {
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
          return {
            id: s.id,
            kind: s.kind,
            attempt: s.attempt,
            groupId: m.group.id,
            groupTitle: m.group.title,
            state: s.state,
            scheduledAt: s.scheduledAt,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            pausedMs: s.pausedMs,
            durationMs: elapsedMs(snapshot, serverNow),
            attendance: m.attendance,
            staff: m.group.staff.map((a) => ({
              name: a.member.user.name,
              email: a.member.user.email,
              role: a.role,
              canEvaluate: a.canEvaluate,
            })),
          }
        }),
      )

  const gdSessions = sessionsFor("GD")
  const piSessions = sessionsFor("PI")

  const bypassEvent = candidate.handoffs.filter((h) => h.bypass && !h.reversedAt).at(-1)

  // The explicit answer to "why is there no GD data here?".
  let gdStatus: GdStatus
  if (bypassEvent) {
    gdStatus = {
      kind: "bypassed",
      reason: bypassEvent.reason,
      actorName: userById.get(bypassEvent.actorId)?.name ?? userById.get(bypassEvent.actorId)?.email ?? null,
      actorRole: bypassEvent.actorRole,
      at: bypassEvent.createdAt,
    }
  } else if (!candidate.gdRequired) {
    // Configured as PI-only from the start, not a bypass, and not missing data.
    gdStatus = { kind: "not-required" }
  } else if (gdSessions.some((s) => s.state === "COMPLETED")) {
    gdStatus = { kind: "completed" }
  } else {
    gdStatus = { kind: "pending" }
  }

  return {
    candidate: {
      id: candidate.id,
      cycleId: candidate.cycleId,
      fullName: candidate.fullName,
      email: candidate.email,
      phone: candidate.phone,
      year: candidate.year,
      branch: candidate.branch,
      stage: candidate.stage,
      result: candidate.result,
      gdRequired: candidate.gdRequired,
      piRequired: candidate.piRequired,
      version: candidate.version,
      manualEditedFields: candidate.manualEditedFields,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      recruitedUserId: candidate.recruitedUserId,
      recruitedAt: candidate.recruitedAt,
      societyRole: candidate.societyRole,
    },
    formResponse: toFormResponse(candidate.formAnswers),
    importProvenance: {
      sourceSheetKey: candidate.sourceSheetKey,
      sourceRowKey: candidate.sourceRowKey,
      importedAt: candidate.importedAt,
      importedById: candidate.importedById,
    },
    gdStatus,
    gdSessions,
    piSessions,
    gdEvaluations,
    piEvaluations,
    gdAggregate: aggregateScore(gdEvaluations),
    piAggregate: aggregateScore(piEvaluations),
    history: candidate.handoffs.map((h) => ({
      id: h.id,
      fromStage: h.fromStage,
      toStage: h.toStage,
      bypass: h.bypass,
      reason: h.reason,
      actorId: h.actorId,
      actorName: userById.get(h.actorId)?.name ?? userById.get(h.actorId)?.email ?? null,
      actorRole: h.actorRole,
      sessionId: h.sessionId,
      reversedAt: h.reversedAt,
      reverseReason: h.reverseReason,
      createdAt: h.createdAt,
    })),
    // Completed PI sessions before the current one.
    previousPiAttempts: piSessions.filter((s) => s.state === "COMPLETED" || s.state === "ABORTED").length,
    gdCriteria: criteriaFor(config, "GD"),
    piCriteria: criteriaFor(config, "PI"),
    serverNow,
  }
}
