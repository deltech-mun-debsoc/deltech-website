"use server"

// Delegate registration through a Google Form response sheet.
//
// Preview and apply run the SAME planner (src/lib/delegate-import.ts), so what an
// organiser approves is literally what gets written. Apply is keyed on a hash of
// (source, mapping, content), so a double-click or a retry returns the first
// result instead of importing twice.
//
// Nothing here allots anyone or sends an email. Every imported delegate lands as
// REGISTERED, and allotment stays a human decision on the Allotment board.

import { revalidatePath } from "next/cache"
import { read, utils } from "xlsx"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { deriveCsvUrl } from "@/lib/gsheet-url"
import { getContent } from "@/lib/settings"
import { sheetKeyFromUrl, summarisePlan, type DuplicateGroup, type ImportPlan } from "@/lib/sheet-import"
import {
  delegateImportIdempotencyKey,
  planDelegateImport,
  type ExistingDelegate,
  type MappedDelegate,
} from "@/lib/delegate-import"
import {
  DELEGATE_IMPORT_FIELDS,
  delegateMappingSchema,
  suggestDelegateMapping,
  type DelegateMapping,
} from "@/lib/schemas/delegate-import"
import {
  failureRef,
  isSchemaDrift,
  isUniqueViolation,
  SCHEMA_DRIFT_MESSAGE,
  unexpectedFailureMessage,
} from "@/lib/prisma-errors"

class ImportError extends Error {}

const DTU = "Delhi Technological University"

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof ImportError) return { ok: false, error: err.message }
  if (err instanceof Error && err.name === "TimeoutError") {
    return { ok: false, error: "Google Sheets took too long to respond. Try again in a moment." }
  }
  // A migration merged but never applied leaves the code writing columns the
  // database does not have: a skipped deploy step, and saying so saves a hunt.
  if (isSchemaDrift(err)) return { ok: false, error: SCHEMA_DRIFT_MESSAGE }
  const ref = failureRef(err)
  console.error("[form-responses]", ref.ref, ref.code ?? "-", err)
  return { ok: false, error: unexpectedFailureMessage(ref) }
}

// ---------------------------------------------------------------------------
// Reading the sheet
// ---------------------------------------------------------------------------

async function fetchRows(csvUrl: string): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  const response = await fetch(csvUrl, { signal: AbortSignal.timeout(15000), cache: "no-store" })
  if (!response.ok) {
    throw new ImportError('Google refused the sheet. In Google Sheets press Share and set it to "Anyone with the link, Viewer".')
  }
  // A sheet that isn't shared does NOT fail: Google answers 200 with its sign-in
  // page, which the spreadsheet parser would happily read as one row of HTML.
  // That surfaced as a baffling "missing email" on every row. Catch it here.
  const type = response.headers.get("content-type") ?? ""
  if (type.includes("text/html")) {
    throw new ImportError('That sheet isn\'t shared. In Google Sheets press Share and set it to "Anyone with the link, Viewer".')
  }

  const workbook = read(await response.text(), { type: "string" })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new ImportError("The sheet has no readable tab.")

  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })
  const headers = rows.length > 0 ? Object.keys(rows[0]).map((h) => h.trim()) : []
  return { rows, headers }
}

function resolveSheet(url: string): { csvUrl: string; sheetKey: string } {
  const csvUrl = deriveCsvUrl(url)
  const sheetKey = sheetKeyFromUrl(url)
  if (!csvUrl || !sheetKey) throw new ImportError("That doesn't look like a Google Sheets link. Copy it from the browser's address bar.")
  return { csvUrl, sheetKey }
}

// Read-only: fetch a sheet's column headers and propose a mapping, so the
// organiser picks from real column names instead of typing them.
export async function readSheetColumns(input: { sheetUrl: string }): Promise<
  | { ok: true; headers: string[]; suggested: Partial<DelegateMapping>; rowCount: number }
  | { ok: false; error: string }
> {
  try {
    await requireStaff()
    const { csvUrl } = resolveSheet(input.sheetUrl)
    const { rows, headers } = await fetchRows(csvUrl)
    if (headers.length === 0) {
      throw new ImportError("The sheet is empty. It needs at least one response before its columns can be read.")
    }
    return { ok: true, headers, suggested: suggestDelegateMapping(headers), rowCount: rows.length }
  } catch (err) {
    return failure(err)
  }
}

// ---------------------------------------------------------------------------
// Source configuration
// ---------------------------------------------------------------------------

export async function saveFormSource(input: {
  label: string
  sheetUrl: string
  mapping: DelegateMapping
}): Promise<{ ok: true; sourceId: string } | { ok: false; error: string }> {
  const label = input.label.trim()
  if (!label) return { ok: false, error: "Give this sheet a name." }

  const mapping = delegateMappingSchema.safeParse(input.mapping)
  if (!mapping.success) {
    const missing = DELEGATE_IMPORT_FIELDS.filter((f) => f.required && !input.mapping?.[f.key]).map((f) => f.label)
    return {
      ok: false,
      error: missing.length
        ? `Pick a column for: ${missing.join(", ")}.`
        : "Some columns aren't matched correctly.",
    }
  }

  try {
    const session = await requireStaff()
    const { csvUrl, sheetKey } = resolveSheet(input.sheetUrl)
    // One source per sheet tab: saving the same tab again updates it rather than
    // creating a rival source with a different mapping.
    const saved = await prisma.delegateSheetSource.upsert({
      where: { sheetKey },
      create: {
        label,
        sheetUrl: input.sheetUrl.trim(),
        csvUrl,
        sheetKey,
        mapping: mapping.data,
        createdById: session.user?.email ?? "unknown",
      },
      update: { label, sheetUrl: input.sheetUrl.trim(), csvUrl, mapping: mapping.data, isActive: true },
      select: { id: true },
    })
    await audit(session.user?.email ?? "unknown", "formSource.save", "DelegateSheetSource", saved.id, {
      label,
      sheetKey,
    })
    revalidatePath("/admin/form-responses")
    return { ok: true, sourceId: saved.id }
  } catch (err) {
    return failure(err)
  }
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

async function loadPlanInputs() {
  const [existing, committees] = await Promise.all([
    prisma.delegate.findMany({
      select: {
        id: true,
        email: true,
        status: true,
        query: true,
        sourceSheetKey: true,
        sourceRowKey: true,
        sourceRowHash: true,
        manualEditedFields: true,
      },
    }),
    prisma.committee.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, aliases: true },
    }),
  ])
  return { existing, committees }
}

async function loadSource(sourceId: string) {
  const source = await prisma.delegateSheetSource.findUnique({
    where: { id: sourceId },
    select: { id: true, label: true, csvUrl: true, sheetKey: true, mapping: true },
  })
  if (!source) throw new ImportError("That sheet isn't connected any more. Reload the page.")
  const mapping = delegateMappingSchema.safeParse(source.mapping)
  if (!mapping.success) throw new ImportError("This sheet's columns aren't fully matched. Open Change this sheet and save it again.")
  return { source, mapping: mapping.data }
}

export interface FormPreviewRow {
  index: number
  outcome: string
  fullName: string | null
  email: string | null
  rollNumber: string | null
  choices: string | null
  errors: string[]
  warnings: string[]
  protectedFields: string[]
  submittedAt: string | null
}

export type FormPreviewResult =
  | {
      ok: true
      rows: FormPreviewRow[]
      counts: ImportPlan<MappedDelegate>["counts"]
      summary: string
      alreadyApplied: boolean
      duplicateGroups: DuplicateGroup[]
    }
  | { ok: false; error: string }

function toPreviewRows(
  plan: ImportPlan<MappedDelegate>,
  mapping: DelegateMapping,
  committeeName: Map<string, string>,
): FormPreviewRow[] {
  return plan.rows.map((r) => {
    const c = r.candidate
    const choice = (committeeId: string | null, portfolio: string | null) =>
      [committeeId ? committeeName.get(committeeId) : null, portfolio].filter(Boolean).join(": ")
    const choices = c ? [choice(c.pref1CommitteeId, c.pref1Portfolio), choice(c.pref2CommitteeId, c.pref2Portfolio)].filter(Boolean).join(" / ") : null
    return {
      index: r.index,
      outcome: r.outcome,
      fullName: c?.fullName ?? r.raw[mapping.fullName] ?? null,
      email: c?.email ?? r.raw[mapping.email] ?? null,
      rollNumber: c?.rollNumber ?? null,
      choices: choices || null,
      errors: r.errors ?? [],
      warnings: r.warnings ?? [],
      protectedFields: r.protectedFields ?? [],
      submittedAt: mapping.timestamp ? r.raw[mapping.timestamp] || null : null,
    }
  })
}

// Read-only. Nothing is written, so an organiser can look as often as they like.
export async function previewFormImport(input: {
  sourceId: string
  duplicateOverrides?: Record<string, number>
}): Promise<FormPreviewResult> {
  try {
    await requireStaff()
    const { source, mapping } = await loadSource(input.sourceId)
    const [{ rows }, { existing, committees }] = await Promise.all([fetchRows(source.csvUrl), loadPlanInputs()])

    const plan = planDelegateImport(rows, mapping, {
      sheetKey: source.sheetKey,
      existing: existing as ExistingDelegate[],
      committees,
      overrides: input.duplicateOverrides ?? {},
    })
    const key = delegateImportIdempotencyKey({
      sourceId: source.id,
      mapping,
      rows: rows as Record<string, string>[],
      overrides: input.duplicateOverrides ?? {},
    })
    const prior = await prisma.delegateImport.findUnique({ where: { idempotencyKey: key }, select: { state: true } })

    return {
      ok: true,
      rows: toPreviewRows(plan, mapping, new Map(committees.map((c) => [c.id, c.name]))),
      counts: plan.counts,
      summary: summarisePlan(plan),
      alreadyApplied: prior?.state === "APPLIED",
      duplicateGroups: plan.duplicateGroups,
    }
  } catch (err) {
    return failure(err)
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type FormApplyResult =
  | { ok: true; idempotent: boolean; created: number; updated: number; skipped: number; invalid: number }
  | { ok: false; error: string }

export async function applyFormImport(input: {
  sourceId: string
  duplicateOverrides?: Record<string, number>
}): Promise<FormApplyResult> {
  let key: string | null = null
  try {
    const session = await requireStaff()
    const actor = session.user?.email ?? "unknown"
    const { source, mapping } = await loadSource(input.sourceId)
    const [{ rows }, { existing, committees }, content] = await Promise.all([
      fetchRows(source.csvUrl),
      loadPlanInputs(),
      getContent(),
    ])

    key = delegateImportIdempotencyKey({
      sourceId: source.id,
      mapping,
      rows: rows as Record<string, string>[],
      overrides: input.duplicateOverrides ?? {},
    })
    const prior = await prisma.delegateImport.findUnique({ where: { idempotencyKey: key } })
    if (prior?.state === "APPLIED") {
      return {
        ok: true,
        idempotent: true,
        created: prior.rowsCreated,
        updated: prior.rowsUpdated,
        skipped: prior.rowsSkipped,
        invalid: prior.rowsInvalid,
      }
    }

    const plan = planDelegateImport(rows, mapping, {
      sheetKey: source.sheetKey,
      existing: existing as ExistingDelegate[],
      committees,
      overrides: input.duplicateOverrides ?? {},
    })

    // Fixed by the event, not by the row: an Intra MUN form only admits DTU
    // students, and has no institution question. ponytail: event-mode switch,
    // make it a per-source setting if a conference ever registers by form.
    const intra = content.eventMode === "INTRA_MUN"
    const previousQuery = new Map(existing.map((e) => [e.id, e.query]))
    const idempotencyKey = key

    const result = await prisma.$transaction(
      async (tx) => {
        // Claiming the key inside the transaction means two concurrent applies
        // cannot both proceed: the second hits the unique index.
        const importRow = await tx.delegateImport.create({
          data: { sourceId: source.id, idempotencyKey, state: "PENDING", rowsTotal: plan.counts.total, importedById: actor },
          select: { id: true },
        })

        let created = 0
        let updated = 0
        for (const row of plan.rows) {
          if (row.outcome === "create" && row.candidate) {
            const d = row.candidate
            await tx.delegate.create({
              data: {
                fullName: d.fullName,
                email: d.email,
                whatsapp: d.whatsapp,
                rollNumber: d.rollNumber,
                munExperience: d.munExperience,
                pref1CommitteeId: d.pref1CommitteeId,
                pref1Portfolio: d.pref1Portfolio,
                pref2CommitteeId: d.pref2CommitteeId,
                pref2Portfolio: d.pref2Portfolio,
                query: d.query,
                institution: intra ? DTU : "Not provided",
                isDtu: intra,
                source: "SELF",
                sourceNote: `Google Form: ${source.label}`,
                status: "REGISTERED",
                sourceSheetKey: source.sheetKey,
                sourceRowKey: row.rowKey,
                sourceRowHash: row.rowHash,
              },
            })
            created++
          } else if (row.outcome === "update" && row.candidateId && row.changes) {
            // `changes` already has hand-edited fields and the email removed by the
            // planner: a refetch never clobbers an organiser's work.
            const queryChanged =
              "query" in row.changes && (row.changes.query ?? null) !== (previousQuery.get(row.candidateId) ?? null)
            await tx.delegate.update({
              where: { id: row.candidateId },
              data: {
                ...row.changes,
                // A new or different question reopens it; an unchanged one stays
                // answered.
                ...(queryChanged ? { queryResolvedAt: null } : {}),
                sourceSheetKey: source.sheetKey,
                sourceRowKey: row.rowKey,
                sourceRowHash: row.rowHash,
              },
            })
            updated++
          }
        }

        const errors = plan.rows
          .filter((r) => r.outcome === "invalid" || r.outcome === "skip-duplicate")
          .map((r) => ({ rowIndex: r.index, reason: (r.errors ?? []).join(" "), raw: r.raw }))

        const skipped = plan.counts.skipUnchanged + plan.counts.skipDuplicate
        await tx.delegateImport.update({
          where: { id: importRow.id },
          data: {
            state: "APPLIED",
            rowsCreated: created,
            rowsUpdated: updated,
            rowsSkipped: skipped,
            rowsInvalid: plan.counts.invalid,
            errors: errors.length > 0 ? errors : undefined,
            finishedAt: new Date(),
          },
        })
        await tx.delegateSheetSource.update({ where: { id: source.id }, data: { lastImportedAt: new Date() } })

        return { created, updated, skipped, invalid: plan.counts.invalid }
      },
      // A large sheet does a lot of row work; the default 5s is too tight.
      { timeout: 120_000 },
    )

    await audit(actor, "formSource.import", "DelegateSheetSource", source.id, {
      summary: summarisePlan(plan),
      ...result,
    })
    revalidatePath("/admin/form-responses")
    revalidatePath("/admin/registrations")
    revalidatePath("/admin/allotment")
    return { ok: true, idempotent: false, ...result }
  } catch (err) {
    if (isUniqueViolation(err) && key) {
      // Two different unique indexes can fire here, and they mean opposite things.
      // Check which one it was instead of guessing from the error.
      const claimed = await prisma.delegateImport.findUnique({ where: { idempotencyKey: key } })
      if (claimed?.state === "APPLIED") {
        // A concurrent apply of the same content won: the work happened.
        return {
          ok: true,
          idempotent: true,
          created: claimed.rowsCreated,
          updated: claimed.rowsUpdated,
          skipped: claimed.rowsSkipped,
          invalid: claimed.rowsInvalid,
        }
      }
      // Otherwise an email in this sheet was registered some other way between
      // preview and import. The whole import rolled back; a fresh preview will
      // show that row as a clash.
      return {
        ok: false,
        error: "Someone registered with one of these emails a moment ago. Nothing was imported. Press Refetch & preview again.",
      }
    }
    return failure(err)
  }
}

// ---------------------------------------------------------------------------
// Questions from registrants
// ---------------------------------------------------------------------------

export async function markQueryAnswered(delegateId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireStaff()
    await prisma.delegate.update({ where: { id: delegateId }, data: { queryResolvedAt: new Date() } })
    await audit(session.user?.email ?? "unknown", "delegate.queryAnswered", "Delegate", delegateId)
    revalidatePath("/admin/form-responses")
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}
