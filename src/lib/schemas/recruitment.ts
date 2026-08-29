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
  // Society roles a selected candidate may be recruited into. ADMIN and
  // MAINTAINER are excluded by the schema, not just the UI, so finalisation can
  // never hand out admin dashboard access.
  societyRoles: z
    .array(z.enum(["AUTHOR", "SUB_MAINTAINER", "REGISTERER"]))
    .min(1)
    .default(["AUTHOR", "SUB_MAINTAINER"]),
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

// SELECT is a hiring decision, and a GD panel does not make one: a GD can only
// advance a candidate to PI, hold them, or reject them. Offering SELECT there
// invited a panel to believe they had selected someone when the value is inert.
// Enforced on the server as well as the form, so the UI is not the only guard.
export const RECOMMENDATIONS_BY_KIND = {
  GD: ["ADVANCE", "HOLD", "REJECT", "RECONSIDER"],
  PI: ["ADVANCE", "HOLD", "REJECT", "SELECT", "RECONSIDER"],
} as const satisfies Record<"GD" | "PI", readonly z.infer<typeof recommendationSchema>[]>

export function recommendationAllowed(
  kind: "GD" | "PI",
  recommendation: z.infer<typeof recommendationSchema>,
): boolean {
  return (RECOMMENDATIONS_BY_KIND[kind] as readonly string[]).includes(recommendation)
}

export const evaluationInputSchema = z.object({
  candidateId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  // { criterionKey: score }. Validated against the cycle's rubric separately by
  // validateScores, which needs the criteria list.
  scores: z.record(z.string(), z.number()),
  remarks: z.string().max(4000).optional(),
  recommendation: recommendationSchema.optional(),
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
  title: z.string().min(2).max(120),
  scheduledAt: z.coerce.date().nullable().optional(),
  candidateIds: z.array(z.string().min(1)).max(60).default([]),
  // Staff assignments, with the explicit evaluate permission for JCs.
  staff: z
    .array(z.object({ memberId: z.string().min(1), canEvaluate: z.boolean().default(false) }))
    .max(20)
    .default([]),
  notes: z.string().max(2000).optional(),
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
  // Never ADMIN or MAINTAINER: recruitment must not grant dashboard access.
  societyRole: z.enum(["AUTHOR", "SUB_MAINTAINER", "REGISTERER"]),
  // When present, also create a public team roster row.
  designation: z.string().min(2).max(80).optional(),
})

export const attendanceSchema = z.object({
  groupMemberId: z.string().min(1),
  attendance: z.enum(["EXPECTED", "PRESENT", "LATE", "ABSENT", "REASSIGNED"]),
})
