"use server"

import { revalidatePath } from "next/cache"
import { read, utils } from "xlsx"
import { prisma } from "@/lib/prisma"
import { RecruitmentDenied, requireRecruitmentAction } from "@/lib/recruitment/authz"
import { auditRecruitmentTx, auditRecruitment, newRequestId } from "@/lib/recruitment/audit"
import { deriveCsvUrl } from "@/lib/gsheet-url"
import {
  importIdempotencyKey,
  planImport,
  sheetKeyFromUrl,
  summarisePlan,
  type ExistingCandidate,
  type ImportPlan,
} from "@/lib/recruitment/import"
import {
  candidateMappingSchema,
  parseCycleConfig,
  sheetSourceSchema,
  type CandidateMapping,
} from "@/lib/schemas/recruitment"

// Google Sheets response import for a recruitment cycle.
//
// Preview and apply run the SAME planner (src/lib/recruitment/import.ts), so what
// an operator approves is literally what gets written. Apply is keyed on a hash of
// (cycle, source, mapping, content) held in RecruitmentImport.idempotencyKey, so a
// double-click or a network retry returns the first result instead of importing
// twice.

export interface PreviewRow {
  index: number
  outcome: string
  fullName: string | null
  email: string | null
  phone: string | null
  year: string | null
  branch: string | null
  errors: string[]
  protectedFields: string[]
  // Only the headers the mapping uses, for a compact preview table.
  raw: Record<string, string>
}

export type PreviewResult =
  | {
      ok: true
      rows: PreviewRow[]
      counts: ImportPlan["counts"]
      summary: string
      headers: string[]
      idempotencyKey: string
      alreadyApplied: boolean
      // Emails that appeared more than once, so the operator can see which
      // submission won and pick a different one before applying.
      duplicateGroups: ImportPlan["duplicateGroups"]
    }
  | { ok: false; error: string }

function denied(error: unknown): { ok: false; error: string } {
  if (error instanceof RecruitmentDenied) {
    return {
      ok: false,
      error:
        error.detail === "cycle-state"
          ? "This recruitment cycle's current state does not allow imports."
          : "You are not permitted to import responses.",
    }
  }
  console.error("[recruitment/import]", error)
  return { ok: false, error: "Something went wrong. Reload and try again." }
}

// ---------------------------------------------------------------------------
// Source configuration
// ---------------------------------------------------------------------------

// Admin-only. The sheet URL and its column mapping are stored on the cycle rather
// than in a global Setting, so two cycles can pull from different forms.
export async function saveSheetSource(input: {
  cycleId: string
  sourceId?: string
  label: string
  sheetUrl: string
  mapping: CandidateMapping
}): Promise<{ ok: boolean; sourceId?: string; error?: string }> {
  const parsed = sheetSourceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid source." }
  }

  const csvUrl = deriveCsvUrl(parsed.data.sheetUrl)
  const sheetKey = sheetKeyFromUrl(parsed.data.sheetUrl)
  if (!csvUrl || !sheetKey) {
    return { ok: false, error: "Paste a valid Google Sheets sharing link." }
  }

  try {
    const ctx = await requireRecruitmentAction(input.cycleId, "import.configure")

    const source = await prisma.$transaction(async (tx) => {
      // One source per (cycle, sheet tab): re-saving the same tab updates it
      // rather than creating a rival source with a divergent mapping.
      const saved = await tx.recruitmentSheetSource.upsert({
        where: { cycleId_sheetKey: { cycleId: input.cycleId, sheetKey } },
        create: {
          cycleId: input.cycleId,
          label: parsed.data.label.trim(),
          sheetUrl: parsed.data.sheetUrl.trim(),
          csvUrl,
          sheetKey,
          mapping: parsed.data.mapping,
          createdById: ctx.userId,
        },
        update: {
          label: parsed.data.label.trim(),
          sheetUrl: parsed.data.sheetUrl.trim(),
          csvUrl,
          mapping: parsed.data.mapping,
          isActive: true,
        },
        select: { id: true },
      })

      await auditRecruitmentTx(tx, {
        eventType: "import.configureSource",
        actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
        cycleId: input.cycleId,
        newState: { sheetKey, label: parsed.data.label.trim(), mapping: parsed.data.mapping },
        meta: { implicit: ctx.implicit },
      })

      return saved
    })

    revalidatePath("/recruitment/responses")
    return { ok: true, sourceId: source.id }
  } catch (err) {
    return denied(err)
  }
}

// ---------------------------------------------------------------------------
// Fetch + plan
// ---------------------------------------------------------------------------

async function fetchRows(csvUrl: string): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  const response = await fetch(csvUrl, { signal: AbortSignal.timeout(15000), cache: "no-store" })
  if (!response.ok) {
    throw new ImportError('Google refused the sheet. Set sharing to "Anyone with the link can view".')
  }
  const workbook = read(await response.text(), { type: "string" })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new ImportError("The sheet has no readable tab.")

  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })
  const headers = rows.length > 0 ? Object.keys(rows[0]).map((h) => h.trim()) : []
  return { rows, headers }
}

async function existingCandidates(cycleId: string): Promise<ExistingCandidate[]> {
  const rows = await prisma.recruitmentCandidate.findMany({
    where: { cycleId },
    select: {
      id: true,
      email: true,
      sourceRowKey: true,
      sourceRowHash: true,
      manualEditedFields: true,
    },
  })
  return rows
}

function toPreviewRows(plan: ImportPlan, mapping: CandidateMapping): PreviewRow[] {
  const usedHeaders = Object.values(mapping)
  return plan.rows.map((r) => ({
    index: r.index,
    outcome: r.outcome,
    fullName: r.candidate?.fullName ?? null,
    email: r.candidate?.email ?? null,
    phone: r.candidate?.phone ?? null,
    year: r.candidate?.year ?? null,
    branch: r.candidate?.branch ?? null,
    errors: r.errors ?? [],
    protectedFields: r.protectedFields ?? [],
    raw: Object.fromEntries(usedHeaders.filter((h) => r.raw[h] !== undefined).map((h) => [h, r.raw[h]])),
  }))
}

// Read-only. Nothing is written, so an operator can inspect a sheet freely.
export async function previewImport(input: {
  cycleId: string
  sourceId: string
  // { email: rowIndex } chosen by the operator, overriding the automatic winner.
  duplicateOverrides?: Record<string, number>
}): Promise<PreviewResult> {
  try {
    await requireRecruitmentAction(input.cycleId, "import.preview")

    const source = await prisma.recruitmentSheetSource.findFirst({
      where: { id: input.sourceId, cycleId: input.cycleId },
      select: { id: true, csvUrl: true, mapping: true },
    })
    if (!source) return { ok: false, error: "That sheet source is not configured on this cycle." }

    const mapping = candidateMappingSchema.safeParse(source.mapping)
    if (!mapping.success) return { ok: false, error: "This source's column mapping is incomplete." }

    const { rows, headers } = await fetchRows(source.csvUrl)
    const plan = planImport(
      rows,
      mapping.data,
      await existingCandidates(input.cycleId),
      input.duplicateOverrides ?? {},
    )
    const key = importIdempotencyKey({
      cycleId: input.cycleId,
      sourceId: source.id,
      mapping: mapping.data,
      rows: rows as Record<string, string>[],
      overrides: input.duplicateOverrides ?? {},
    })
    // Tell the operator up front that this exact content was already applied.
    const prior = await prisma.recruitmentImport.findUnique({
      where: { idempotencyKey: key },
      select: { state: true },
    })

    return {
      ok: true,
      rows: toPreviewRows(plan, mapping.data),
      counts: plan.counts,
      summary: summarisePlan(plan),
      headers,
      idempotencyKey: key,
      alreadyApplied: prior?.state === "APPLIED",
      duplicateGroups: plan.duplicateGroups,
    }
  } catch (err) {
    if (err instanceof ImportError) return { ok: false, error: err.message }
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, error: "Google Sheets took too long to respond." }
    }
    return denied(err)
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type ApplyResult =
  | {
      ok: true
      idempotent: boolean
      created: number
      updated: number
      skipped: number
      invalid: number
      importId: string
    }
  | { ok: false; error: string }

export async function applyImport(input: {
  cycleId: string
  duplicateOverrides?: Record<string, number>
  sourceId: string
}): Promise<ApplyResult> {
  try {
    const ctx = await requireRecruitmentAction(input.cycleId, "import.apply")
    const requestId = newRequestId()

    const source = await prisma.recruitmentSheetSource.findFirst({
      where: { id: input.sourceId, cycleId: input.cycleId },
      select: { id: true, csvUrl: true, mapping: true, sheetKey: true },
    })
    if (!source) return { ok: false, error: "That sheet source is not configured on this cycle." }

    const mapping = candidateMappingSchema.safeParse(source.mapping)
    if (!mapping.success) return { ok: false, error: "This source's column mapping is incomplete." }

    const { rows } = await fetchRows(source.csvUrl)
    const key = importIdempotencyKey({
      cycleId: input.cycleId,
      sourceId: source.id,
      mapping: mapping.data,
      rows: rows as Record<string, string>[],
      overrides: input.duplicateOverrides ?? {},
    })

    // Idempotency: the same sheet content applied twice returns the first result.
    const prior = await prisma.recruitmentImport.findUnique({ where: { idempotencyKey: key } })
    if (prior && prior.state === "APPLIED") {
      return {
        ok: true,
        idempotent: true,
        created: prior.rowsCreated,
        updated: prior.rowsUpdated,
        skipped: prior.rowsSkipped,
        invalid: prior.rowsInvalid,
        importId: prior.id,
      }
    }

    const cycleConfig = parseCycleConfig(ctx.cycle.config)
    const plan = planImport(
      rows,
      mapping.data,
      await existingCandidates(input.cycleId),
      input.duplicateOverrides ?? {},
    )

    const result = await prisma.$transaction(
      async (tx) => {
        // Claiming the idempotency key inside the transaction means two concurrent
        // applies cannot both proceed: the second hits the unique index and is
        // resolved as the duplicate it is.
        const importRow = await tx.recruitmentImport.create({
          data: {
            cycleId: input.cycleId,
            sourceId: source.id,
            idempotencyKey: key,
            state: "PENDING",
            rowsTotal: plan.counts.total,
            importedById: ctx.userId,
          },
          select: { id: true },
        })

        let created = 0
        let updated = 0

        for (const row of plan.rows) {
          if (row.outcome === "create" && row.candidate) {
            await tx.recruitmentCandidate.create({
              data: {
                cycleId: input.cycleId,
                fullName: row.candidate.fullName,
                email: row.candidate.email,
                phone: row.candidate.phone,
                year: row.candidate.year,
                branch: row.candidate.branch,
                formAnswers: row.raw,
                sourceSheetKey: source.sheetKey,
                sourceRowKey: row.rowKey,
                sourceRowHash: row.rowHash,
                importedById: ctx.userId,
                importedAt: new Date(),
                // Stage requirements come from the cycle's configuration, so a
                // PI-only cycle lands candidates straight in the PI queue.
                gdRequired: cycleConfig.stages.gdRequiredByDefault,
                piRequired: cycleConfig.stages.piRequiredByDefault,
              },
            })
            created++
          } else if (row.outcome === "update" && row.candidateId) {
            await tx.recruitmentCandidate.update({
              where: { id: row.candidateId },
              data: {
                // `changes` already has hand-edited fields and the email removed
                // by the planner: an import never clobbers manual work.
                ...row.changes,
                formAnswers: row.raw,
                sourceSheetKey: source.sheetKey,
                sourceRowKey: row.rowKey,
                sourceRowHash: row.rowHash,
              },
            })
            updated++
          }
          // skip-unchanged / skip-duplicate / invalid: nothing is written, and the
          // reasons are recorded on the import row below.
        }

        const errors = plan.rows
          .filter((r) => r.outcome === "invalid" || r.outcome === "skip-duplicate")
          .map((r) => ({ rowIndex: r.index, reason: (r.errors ?? []).join(" "), raw: r.raw }))

        await tx.recruitmentImport.update({
          where: { id: importRow.id },
          data: {
            state: "APPLIED",
            rowsCreated: created,
            rowsUpdated: updated,
            rowsSkipped: plan.counts.skipUnchanged + plan.counts.skipDuplicate,
            rowsInvalid: plan.counts.invalid,
            errors: errors.length > 0 ? errors : undefined,
            finishedAt: new Date(),
          },
        })

        await auditRecruitmentTx(tx, {
          eventType: "import.apply",
          actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
          cycleId: input.cycleId,
          previousState: null,
          newState: {
            created,
            updated,
            skipped: plan.counts.skipUnchanged + plan.counts.skipDuplicate,
            invalid: plan.counts.invalid,
          },
          reason: summarisePlan(plan),
          meta: {
            sheetKey: source.sheetKey,
            importId: importRow.id,
            protectedRows: plan.rows.filter((r) => (r.protectedFields?.length ?? 0) > 0).length,
            implicit: ctx.implicit,
          },
          requestId,
        })

        return {
          importId: importRow.id,
          created,
          updated,
          skipped: plan.counts.skipUnchanged + plan.counts.skipDuplicate,
          invalid: plan.counts.invalid,
        }
      },
      // A large sheet does a lot of row work; the default 5s is too tight.
      { timeout: 120_000 },
    )

    revalidatePath("/recruitment/responses")
    revalidatePath("/recruitment/candidates", "layout")
    revalidatePath("/admin/recruitment", "layout")
    return { ok: true, idempotent: false, ...result }
  } catch (err) {
    // A concurrent apply claimed the key first: return its result rather than
    // reporting a failure for work that did in fact happen.
    if (isUniqueViolation(err)) {
      const winner = await prisma.recruitmentImport.findFirst({
        where: { cycleId: input.cycleId, sourceId: input.sourceId },
        orderBy: { startedAt: "desc" },
      })
      if (winner) {
        return {
          ok: true,
          idempotent: true,
          created: winner.rowsCreated,
          updated: winner.rowsUpdated,
          skipped: winner.rowsSkipped,
          invalid: winner.rowsInvalid,
          importId: winner.id,
        }
      }
    }
    if (err instanceof ImportError) return { ok: false, error: err.message }
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, error: "Google Sheets took too long to respond." }
    }
    await auditRecruitment({
      eventType: "import.apply",
      actor: { email: "unknown" },
      cycleId: input.cycleId,
      reason: err instanceof Error ? err.message : "Unknown import failure.",
      outcome: "FAILED",
    })
    return denied(err)
  }
}

class ImportError extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002"
  )
}
