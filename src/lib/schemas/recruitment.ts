import { z } from "zod"

// Zod contracts for everything crossing a trust boundary in the recruitment
// module: cycle configuration, sheet column mappings, and evaluation payloads.
// Server actions parse with these before touching the database: a client is
// never trusted to send a well-formed shape.

// ---------------------------------------------------------------------------
// Cycle configuration
// ---------------------------------------------------------------------------

// One scoring criterion on the rubric. `weight` lets a cycle decide that
// "Content" counts double without changing any code.
export const evaluationCriterionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    // Used as a JSON object key and a form field name: keep it boring.
    .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, digits and underscores."),
  label: z.string().min(1).max(60),
  max: z.number().int().min(1).max(100),
  weight: z.number().min(0).max(10).default(1),
})

export type EvaluationCriterion = z.infer<typeof evaluationCriterionSchema>

export const stageRulesSchema = z.object({
  // Whether new candidates need each stage by default. A cycle that only runs
  // interviews sets gdRequired false and every import lands straight in the PI
  // queue: no code path special-cases it.
  gdRequiredByDefault: z.boolean().default(true),
  piRequiredByDefault: z.boolean().default(true),
  // Minimum submitted GD evaluations before a candidate may advance. 0 disables.
  minGdEvaluations: z.number().int().min(0).max(10).default(1),
  minPiEvaluations: z.number().int().min(0).max(10).default(1),
  // Default planned length, used to prefill a session's timer target. Advisory:
  // the server never auto-ends a session, it only reports elapsed time.
  gdPlannedSeconds: z.number().int().min(60).max(4 * 60 * 60).default(15 * 60),
  piPlannedSeconds: z.number().int().min(60).max(4 * 60 * 60).default(10 * 60),
  // Whether a maintainer may bypass GD in this cycle at all. Role permission is
  // still required on top of this; the flag lets a cycle switch it off entirely.
  allowGdBypass: z.boolean().default(true),
})

export const recruitmentCycleConfigSchema = z.object({
  stages: stageRulesSchema.default(stageRulesSchema.parse({})),
  gdCriteria: z.array(evaluationCriterionSchema).max(12).default([
    { key: "content", label: "Content & research", max: 10, weight: 1 },
    { key: "communication", label: "Communication", max: 10, weight: 1 },
    { key: "collaboration", label: "Collaboration", max: 10, weight: 1 },
  ]),
  piCriteria: z.array(evaluationCriterionSchema).max(12).default([
    { key: "motivation", label: "Motivation & fit", max: 10, weight: 1 },
    { key: "reasoning", label: "Reasoning", max: 10, weight: 1 },
    { key: "ownership", label: "Ownership", max: 10, weight: 1 },
  ]),
  // Recruitment creates ordinary society members. Author onboarding is a
  // separate later action, never part of the selection workflow.
  societyRoles: z
    .array(z.literal("MEMBER"))
    .length(1)
    .catch(["MEMBER"])
    .default(["MEMBER"]),
})

export type RecruitmentCycleConfig = z.infer<typeof recruitmentCycleConfigSchema>

// Parsing a stored `config Json` column. Always use this rather than a cast: an
// older row may predate a config field, and the defaults fill it in.
export function parseCycleConfig(raw: unknown): RecruitmentCycleConfig {
  const result = recruitmentCycleConfigSchema.safeParse(raw ?? {})
  return result.success ? result.data : recruitmentCycleConfigSchema.parse({})
}

export function criteriaFor(config: RecruitmentCycleConfig, kind: "GD" | "PI"): EvaluationCriterion[] {
  return kind === "GD" ? config.gdCriteria : config.piCriteria
}

// ---------------------------------------------------------------------------
// Cycle creation / editing
// ---------------------------------------------------------------------------

export const cycleSlugSchema = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.")

export const createCycleSchema = z.object({
  name: z.string().min(3).max(120),
  slug: cycleSlugSchema,
})

// ---------------------------------------------------------------------------
// Candidate fields an import can populate
// ---------------------------------------------------------------------------

export const CANDIDATE_IMPORT_FIELDS = [
  { key: "fullName", label: "Full name", required: true },
  { key: "email", label: "Email address", required: true },
  { key: "phone", label: "Phone / WhatsApp", required: false },
  { key: "year", label: "Year / batch", required: false },
  { key: "branch", label: "Branch / department", required: false },
  // Optional, but map it when the sheet has one: it is what lets a resubmission
  // supersede the original instead of the oldest row winning by arrival order.
  { key: "timestamp", label: "Submitted at", required: false },
] as const

export type CandidateFieldKey = (typeof CANDIDATE_IMPORT_FIELDS)[number]["key"]

// { candidateField: sheetColumnHeader }. Name and email are mandatory because a
// row without them cannot identify a candidate; the rest are genuinely optional,
// so this is an object rather than a Record (which zod makes all-required).
export const candidateMappingSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().min(1),
  phone: z.string().min(1).optional(),
  year: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  timestamp: z.string().min(1).optional(),
})

export type CandidateMapping = z.infer<typeof candidateMappingSchema>

export const sheetSourceSchema = z.object({
  label: z.string().min(2).max(80),
  sheetUrl: z.string().url("Paste the Google Sheets sharing link."),
  mapping: candidateMappingSchema,
})

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export const recommendationSchema = z.enum(["ADVANCE", "HOLD", "REJECT", "SELECT", "RECONSIDER"])

// Both assessment rounds use the same small vocabulary. The session finish
// resolves panel votes and applies the resulting transition atomically.
export const RECOMMENDATIONS_BY_KIND = {
  GD: ["SELECT", "HOLD", "REJECT"],
  PI: ["SELECT", "HOLD", "REJECT"],
} as const satisfies Record<"GD" | "PI", readonly z.infer<typeof recommendationSchema>[]>

export function recommendationAllowed(
  kind: "GD" | "PI",
  recommendation: z.infer<typeof recommendationSchema>,
): boolean {
  return (RECOMMENDATIONS_BY_KIND[kind] as readonly string[]).includes(recommendation)
}

export type PanelRecommendation = "SELECT" | "HOLD" | "REJECT"

// A clear panel majority wins. Any tie is held for a human decision instead of
// silently rejecting or advancing somebody on an arbitrary evaluator order.
export function resolvePanelRecommendation(
  recommendations: readonly (PanelRecommendation | null | undefined)[],
): PanelRecommendation | null {
  const votes = recommendations.filter((value): value is PanelRecommendation =>
    value === "SELECT" || value === "HOLD" || value === "REJECT",
  )
  if (votes.length === 0) return null

  const counts: Record<PanelRecommendation, number> = { SELECT: 0, HOLD: 0, REJECT: 0 }
  for (const vote of votes) counts[vote] += 1
  const highest = Math.max(...Object.values(counts))
  const leaders = (Object.keys(counts) as PanelRecommendation[]).filter(
    (recommendation) => counts[recommendation] === highest,
  )
  return leaders.length === 1 ? leaders[0] : "HOLD"
}

export const evaluationInputSchema = z.object({
  candidateId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  // { criterionKey: score }. Validated against the cycle's rubric separately by
  // validateScores, which needs the criteria list.
  scores: z.record(z.string(), z.number()),
  remarks: z.string().max(4000).optional(),
  recommendation: recommendationSchema.optional(),
  // A maintainer operating the shared panel laptop may record the score for an
  // assigned panelist. Authorization is resolved from the group, never trusted.
  panelistUserId: z.string().min(1).optional(),
  // Client-generated so a retried submit collapses onto the same row.
  idempotencyKey: z.string().min(8).max(120).optional(),
  // Version the client was editing, for optimistic concurrency on revisions.
  expectedVersion: z.number().int().min(0).optional(),
})

export type EvaluationInput = z.infer<typeof evaluationInputSchema>

export interface ScoreValidation {
  ok: boolean
  errors: string[]
  // Weighted mean, normalised to a 0–10 scale so GD and PI rubrics with
  // different maxima remain comparable on the dossier.
  overall: number | null
}

// Scores are checked against the cycle's rubric, not a hardcoded 0–10 range:
// unknown criteria, missing criteria and out-of-range values are all refused.
export function validateScores(
  scores: Record<string, number>,
  criteria: EvaluationCriterion[],
  { requireAll = true }: { requireAll?: boolean } = {},
): ScoreValidation {
  const errors: string[] = []
  const byKey = new Map(criteria.map((c) => [c.key, c]))

  for (const key of Object.keys(scores)) {
    if (!byKey.has(key)) errors.push(`Unknown criterion "${key}".`)
  }

  let weighted = 0
  let weightTotal = 0
  let provided = 0

  for (const c of criteria) {
    const value = scores[c.key]
    if (value === undefined || value === null) {
      if (requireAll) errors.push(`Missing score for "${c.label}".`)
      continue
    }
    if (!Number.isFinite(value)) {
      errors.push(`Score for "${c.label}" must be a number.`)
      continue
    }
    if (value < 0 || value > c.max) {
      errors.push(`Score for "${c.label}" must be between 0 and ${c.max}.`)
      continue
    }
    provided++
    // Normalise each criterion to 0–1 before weighting, so a criterion scored
    // out of 100 doesn't dominate one scored out of 10.
    weighted += (value / c.max) * c.weight
    weightTotal += c.weight
  }

  const overall = provided > 0 && weightTotal > 0 ? Number(((weighted / weightTotal) * 10).toFixed(2)) : null

  return { ok: errors.length === 0, errors, overall }
}

// ---------------------------------------------------------------------------
// Session / candidate mutations
// ---------------------------------------------------------------------------

export const sessionActionSchema = z.object({
  sessionId: z.string().min(1),
  // What the client believed the state was. A mismatch is a conflict, not a
  // silent overwrite.
  expectedVersion: z.number().int().min(0).optional(),
  reason: z.string().max(500).optional(),
})

export const createGroupSchema = z.object({
  kind: z.enum(["GD", "PI"]),
  // One-click PI uses the candidate's name as the panel title. A one-letter
  // name is valid; reject only an actually blank title after trimming.
  title: z.string().trim().min(1).max(120),
  scheduledAt: z.coerce.date().nullable().optional(),
  candidateIds: z.array(z.string().min(1)).max(60).default([]),
  // Staff assignments, with the explicit evaluate permission for JCs.
  staff: z
    .array(z.object({ memberId: z.string().min(1), canEvaluate: z.boolean().default(false) }))
    .max(20)
    .default([]),
  notes: z.string().max(2000).optional(),
}).superRefine((group, ctx) => {
  if (group.kind === "PI" && group.candidateIds.length !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["candidateIds"],
      message: "An interview must have exactly one candidate.",
    })
  }
})

export const bypassGdSchema = z.object({
  candidateId: z.string().min(1),
  // A bypass without a reason is not auditable, so the reason is mandatory.
  reason: z.string().min(10, "Explain why GD is being skipped (10 characters or more).").max(1000),
})

export const stageMoveSchema = z.object({
  candidateId: z.string().min(1),
  to: z.enum([
    "INTAKE",
    "GD_PENDING",
    "GD_ACTIVE",
    "GD_COMPLETE",
    "GD_BYPASSED",
    "PI_PENDING",
    "PI_ACTIVE",
    "PI_COMPLETE",
    "DECISION",
    "CLOSED",
  ]),
  reason: z.string().max(1000).optional(),
  override: z.boolean().default(false),
  expectedVersion: z.number().int().min(0).optional(),
})

export const resultMoveSchema = z.object({
  candidateId: z.string().min(1),
  to: z.enum(["PENDING", "ON_HOLD", "SELECTED", "REJECTED", "WITHDRAWN", "DISQUALIFIED"]),
  reason: z.string().max(1000).optional(),
  expectedVersion: z.number().int().min(0).optional(),
})

export const recruitCandidateSchema = z.object({
  candidateId: z.string().min(1),
  societyRole: z.literal("MEMBER"),
  // When present, also create a public team roster row.
  designation: z.string().min(2).max(80).optional(),
})

export const attendanceSchema = z.object({
  groupMemberId: z.string().min(1),
  attendance: z.enum(["EXPECTED", "PRESENT", "LATE", "ABSENT", "REASSIGNED"]),
})
