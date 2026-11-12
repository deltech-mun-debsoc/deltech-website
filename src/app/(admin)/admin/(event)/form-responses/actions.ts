"use server"

// Delegate registration through a Google Form response sheet.
//
// Preview and apply run the SAME planner (src/lib/delegate-import.ts). Preview
// also hands out a plan token: a hash of (event, source, mapping, sheet content,
// choices). Apply reads the sheet again, recomputes it, and refuses on any
// difference, so a sheet edited or re-sorted after the preview cannot import
// something nobody looked at. The same hash keys the import, so a double-click
// or a retry returns the first result instead of importing twice.
//
// Nothing here allots anyone or sends an email. Every imported delegate lands as
// REGISTERED, and allotment stays a human decision on the Allotment board.

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { fetchSheetRows as fetchRows, SheetFetchError, sheetBotEmail } from "@/lib/sheet-fetch"
import { requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { deriveCsvUrl } from "@/lib/gsheet-url"
import { getContent } from "@/lib/settings"
import { sheetKeyFromUrl, summarisePlan } from "@/lib/sheet-import"
import { normalizeEmail } from "@/lib/intake"
import { addCommitteeAlias } from "../config/actions"
import {
  delegateImportIdempotencyKey,
  parseResolutions,
  planDelegateImport,
  type Bucket,
  type Decision,
  type DelegatePlan,
  type RowResolution,
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
import { currentEventScope, requireActiveEvent } from "@/lib/event"

class ImportError extends Error {}

const DTU = "Delhi Technological University"

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof ImportError || err instanceof SheetFetchError) return { ok: false, error: err.message }
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

function resolveSheet(url: string): { csvUrl: string; sheetKey: string } {
  const csvUrl = deriveCsvUrl(url)
  const sheetKey = sheetKeyFromUrl(url)
  if (!csvUrl || !sheetKey) throw new ImportError("That doesn't look like a Google Sheets link. Copy it from the browser's address bar.")
  return { csvUrl, sheetKey }
}

// Read-only: fetch a sheet's column headers and propose a mapping, so the
// organiser picks from real column names instead of typing them.
export async function readSheetColumns(input: { sheetUrl: string }): Promise<
  | { ok: true; headers: string[]; suggested: Partial<DelegateMapping>; rowCount: number; access: "private" | "public" }
  | { ok: false; error: string }
> {
  try {
    await requireStaff()
    const { csvUrl } = resolveSheet(input.sheetUrl)
    const { rows, headers, access } = await fetchRows(csvUrl)
    if (headers.length === 0) {
      throw new ImportError("The sheet is empty. It needs at least one response before its columns can be read.")
    }
    return { ok: true, headers, suggested: suggestDelegateMapping(headers), rowCount: rows.length, access }
  } catch (err) {
    return failure(err)
  }
}

// ---------------------------------------------------------------------------
// Source configuration
// ---------------------------------------------------------------------------

// The address staff share a sheet with to keep it private, for the connect
// screen. Null when no service account is configured.
export async function formSheetBot(): Promise<string | null> {
  await requireStaff()
  return sheetBotEmail()
}

export async function saveFormSource(input: {
  // Set when changing an existing connection: that connection is replaced,
  // never joined by a second one.
  sourceId?: string
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
    const event = await requireActiveEvent()
    const fields = { label, sheetUrl: input.sheetUrl.trim(), csvUrl, sheetKey, mapping: mapping.data, isActive: true }

    const saved = await prisma.$transaction(async (tx) => {
      const sameTab = await tx.delegateSheetSource.findUnique({
        where: { eventId_sheetKey: { eventId: event.id, sheetKey } },
        select: { id: true, label: true },
      })

      if (input.sourceId) {
        const current = await tx.delegateSheetSource.findUnique({
          where: { id: input.sourceId },
          select: { id: true, eventId: true, sheetKey: true },
        })
        if (!current || current.eventId !== event.id) throw new ImportError("That sheet isn't connected to this event any more. Reload the page.")
        if (sameTab && sameTab.id !== current.id) {
          throw new ImportError(`That sheet is already connected as "${sameTab.label}".`)
        }
        // A new link for the same form (a copied sheet, a new tab): the people
        // already imported come with it. Rows are keyed by email, so they keep
        // matching instead of every one turning into "already registered".
        if (current.sheetKey !== sheetKey) {
          await tx.delegate.updateMany({
            where: { eventId: event.id, sourceSheetKey: current.sheetKey },
            data: { sourceSheetKey: sheetKey },
          })
        }
        return tx.delegateSheetSource.update({ where: { id: current.id }, data: fields, select: { id: true } })
      }

      // One source per tab per event: connecting the same tab again updates it.
      if (sameTab) return tx.delegateSheetSource.update({ where: { id: sameTab.id }, data: fields, select: { id: true } })
      return tx.delegateSheetSource.create({
        data: { ...fields, eventId: event.id, createdById: session.user?.email ?? "unknown" },
        select: { id: true },
      })
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

// This event only. Matched against every event, a student who came last year
// looked already imported, and a committee name could resolve to a closed event.
async function loadPlanInputs() {
  const scope = await currentEventScope()
  const [existing, committees] = await Promise.all([
    prisma.delegate.findMany({
      where: scope,
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        source: true,
        rollNumber: true,
        whatsapp: true,
        query: true,
        sourceSheetKey: true,
        sourceRowKey: true,
        sourceRowHash: true,
        manualEditedFields: true,
        allotment: { select: { portfolio: { select: { name: true, committee: { select: { name: true } } } } } },
      },
    }),
    prisma.committee.findMany({
      where: { isActive: true, ...scope },
      select: { id: true, name: true, slug: true, aliases: true },
    }),
  ])
  return {
    existing: existing.map(({ allotment, ...d }) => ({
      ...d,
      seat: allotment ? `${allotment.portfolio.committee.name} · ${allotment.portfolio.name}` : null,
    })),
    committees,
  }
}

async function loadSource(sourceId: string) {
  const [source, event] = await Promise.all([
    prisma.delegateSheetSource.findUnique({
      where: { id: sourceId },
      select: { id: true, eventId: true, label: true, csvUrl: true, sheetKey: true, mapping: true, resolutions: true },
    }),
    requireActiveEvent(),
  ])
  if (!source || source.eventId !== event.id) throw new ImportError("That sheet isn't connected to this event any more. Reload the page.")
  const mapping = delegateMappingSchema.safeParse(source.mapping)
  if (!mapping.success) throw new ImportError("This sheet's columns aren't fully matched. Open Change this sheet and save it again.")
  return { source, mapping: mapping.data }
}

export interface FormPreviewRow {
  index: number
  rowHash: string
  outcome: string
  bucket: Bucket
  decisions: Decision[]
  fullName: string | null
  email: string | null
  rollNumber: string | null
  choices: string | null
  // What an import would write to an existing delegate, by field label.
  changes: string[]
  errors: string[]
  warnings: string[]
  protectedFields: string[]
  submittedAt: string | null
}

// A person who submitted more than once: the kept answer, and how each other
// submission differs from it, so keeping an earlier one is an informed choice.
export interface RepeatSubmission {
  email: string
  kept: { index: number; rowHash: string; submittedAt: string | null }
  others: { index: number; rowHash: string; submittedAt: string | null; differences: { field: string; kept: string; other: string }[] }[]
  latestKept: boolean
}

export type FormPreviewResult =
  | {
      ok: true
      sourceId: string
      // Hand this back to applyFormImport. It binds the import to this preview.
      planToken: string
      rows: FormPreviewRow[]
      buckets: DelegatePlan["buckets"]
      repeats: RepeatSubmission[]
      alreadyApplied: boolean
      access: "private" | "public"
    }
  | { ok: false; error: string }

const FIELD_LABEL: Record<string, string> = {
  fullName: "Name",
  whatsapp: "Phone",
  rollNumber: "Roll number",
  munExperience: "MUN experience",
  pref1CommitteeId: "First committee",
  pref1Portfolio: "First portfolio",
  pref2CommitteeId: "Second committee",
  pref2Portfolio: "Second portfolio",
  query: "Question",
}

function describe(field: string, value: unknown, committeeName: Map<string, string>): string {
  if (value === null || value === undefined || value === "") return "nothing"
  if (field.endsWith("CommitteeId")) return committeeName.get(String(value)) ?? "unknown committee"
  return String(value)
}

function toPreview(plan: DelegatePlan, mapping: DelegateMapping, committeeName: Map<string, string>, chosen: Set<string>) {
  const submittedAt = (raw: Record<string, string>) => (mapping.timestamp ? raw[mapping.timestamp] || null : null)
  const rows: FormPreviewRow[] = plan.rows.map((r) => {
    const c = r.candidate
    const choice = (committeeId: string | null, portfolio: string | null) =>
      [committeeId ? committeeName.get(committeeId) : null, portfolio].filter(Boolean).join(": ")
    const choices = c ? [choice(c.pref1CommitteeId, c.pref1Portfolio), choice(c.pref2CommitteeId, c.pref2Portfolio)].filter(Boolean).join(" / ") : null
    return {
      index: r.index,
      rowHash: r.rowHash,
      outcome: r.outcome,
      bucket: r.bucket,
      decisions: r.decisions,
      fullName: c?.fullName ?? r.raw[mapping.fullName] ?? null,
      email: c?.email ?? r.raw[mapping.email] ?? null,
      rollNumber: c?.rollNumber ?? null,
      choices: choices || null,
      changes: r.outcome === "update" && r.changes ? Object.keys(r.changes).map((f) => FIELD_LABEL[f] ?? f) : [],
      errors: r.errors ?? [],
      warnings: r.warnings ?? [],
      protectedFields: r.protectedFields ?? [],
      submittedAt: submittedAt(r.raw),
    }
  })

  const repeats: RepeatSubmission[] = plan.duplicateGroups.map((g) => {
    const kept = plan.rows[g.winnerIndex]
    const others = g.rowIndexes
      .filter((i) => i !== g.winnerIndex)
      .map((i) => {
        const other = plan.rows[i]
        const differences = Object.keys(FIELD_LABEL)
          .filter((f) => {
            const a = kept.candidate?.[f as keyof MappedDelegate] ?? null
            const b = other.candidate?.[f as keyof MappedDelegate] ?? null
            return (a ?? "") !== (b ?? "")
          })
          .map((f) => ({
            field: FIELD_LABEL[f],
            kept: describe(f, kept.candidate?.[f as keyof MappedDelegate], committeeName),
            other: describe(f, other.candidate?.[f as keyof MappedDelegate], committeeName),
          }))
        return { index: i, rowHash: other.rowHash, submittedAt: submittedAt(other.raw), differences }
      })
    return {
      email: g.email,
      kept: { index: kept.index, rowHash: kept.rowHash, submittedAt: submittedAt(kept.raw) },
      others,
      // The latest is kept unless the organiser chose an earlier one.
      latestKept: !chosen.has(g.email),
    }
  })
  return { rows, repeats }
}

// Reads the sheet and plans it against this event, with the decisions already
// made for this source. Preview and apply both come through here, so the plan
// and its token are computed one way.
async function planFromSheet(sourceId: string) {
  const { source, mapping } = await loadSource(sourceId)
  const resolutions = parseResolutions(source.resolutions)
  const [{ rows, access }, { existing, committees }] = await Promise.all([fetchRows(source.csvUrl), loadPlanInputs()])
  const plan = planDelegateImport(rows, mapping, {
    sheetKey: source.sheetKey,
    existing: existing as ExistingDelegate[],
    committees,
    resolutions,
  })
  const planToken = delegateImportIdempotencyKey({
    eventId: source.eventId,
    sourceId: source.id,
    mapping,
    rows: rows as Record<string, string>[],
    resolutions,
  })
  return { source, mapping, rows, access, existing, committees, plan, planToken }
}

// Read-only for delegates. It records the source's health (when it was last
// checked and what was found), which is what the source card shows.
export async function previewFormImport(input: { sourceId: string }): Promise<FormPreviewResult> {
  try {
    await requireStaff()
    let planned: Awaited<ReturnType<typeof planFromSheet>>
    try {
      planned = await planFromSheet(input.sourceId)
    } catch (err) {
      if (err instanceof SheetFetchError) {
        await prisma.delegateSheetSource
          .update({ where: { id: input.sourceId }, data: { lastCheckError: err.message } })
          .catch(() => undefined)
      }
      throw err
    }
    const { source, mapping, plan, planToken, access, committees } = planned
    const chosen = new Set(Object.keys(parseResolutions(source.resolutions).keep))
    const prior = await prisma.delegateImport.findUnique({ where: { idempotencyKey: planToken }, select: { state: true } })
    await prisma.delegateSheetSource.update({
      where: { id: source.id },
      data: {
        lastCheckedAt: new Date(),
        lastCheckRows: plan.counts.total,
        lastCheckNeedsAction: plan.buckets.decision,
        lastCheckError: null,
        lastAccess: access,
      },
    })

    const { rows, repeats } = toPreview(plan, mapping, new Map(committees.map((c) => [c.id, c.name])), chosen)
    return {
      ok: true,
      sourceId: source.id,
      planToken,
      rows,
      buckets: plan.buckets,
      repeats,
      alreadyApplied: prior?.state === "APPLIED",
      access,
    }
  } catch (err) {
    return failure(err)
  }
}

// One answer in the review. Kept on the source, so the next check (and every
// routine check after it) already knows it. Clearing one is passing null.
export type ResolutionPatch =
  | { committee: { key: string; committeeId: string | null; alias?: string } }
  | { committeeClear: string }
  | { row: { rowHash: string; value: RowResolution | null } }
  | { keep: { email: string; rowHash: string | null } }

export async function saveImportResolution(input: {
  sourceId: string
  patch: ResolutionPatch
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireStaff()
    const { source } = await loadSource(input.sourceId)
    const res = parseResolutions(source.resolutions)
    const p = input.patch

    if ("committee" in p) {
      const { key, committeeId, alias } = p.committee
      if (committeeId) {
        const committee = await prisma.committee.findFirst({ where: { id: committeeId, eventId: source.eventId }, select: { id: true } })
        if (!committee) throw new ImportError("That committee isn't part of this event.")
      }
      // Saved as another name for the committee: it now resolves by itself, for
      // this sheet and every later one, so no per-source answer is needed.
      if (alias && committeeId) {
        const saved = await addCommitteeAlias(committeeId, alias)
        if (!saved.success) throw new ImportError(saved.error ?? "Could not save that name.")
        delete res.committees[key]
      } else {
        res.committees[key] = committeeId
      }
    } else if ("committeeClear" in p) {
      delete res.committees[p.committeeClear]
    } else if ("row" in p) {
      const v = p.row.value
      if (v && typeof v === "object") {
        const email = normalizeEmail(v.email)
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ImportError(`"${v.email}" is not a valid email address.`)
        res.rows[p.row.rowHash] = { email }
      } else if (v) {
        res.rows[p.row.rowHash] = v
      } else {
        delete res.rows[p.row.rowHash]
      }
    } else if ("keep" in p) {
      if (p.keep.rowHash) res.keep[p.keep.email.toLowerCase()] = p.keep.rowHash
      else delete res.keep[p.keep.email.toLowerCase()]
    }

    await prisma.delegateSheetSource.update({ where: { id: source.id }, data: { resolutions: res as object } })
    await audit(session.user?.email ?? "unknown", "formSource.resolve", "DelegateSheetSource", source.id, { patch: p })
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type FormApplyResult =
  | { ok: true; idempotent: boolean; created: number; updated: number; skipped: number; invalid: number }
  // The sheet, its mapping or the choices changed since the preview. Nothing was
  // written; the organiser checks again.
  | { ok: false; stale: true; error: string }
  | { ok: false; stale?: false; error: string }

const STALE = "The sheet changed since you checked it, so nothing was imported. Check it again, then import."

export async function applyFormImport(input: {
  sourceId: string
  planToken: string
}): Promise<FormApplyResult> {
  let key: string | null = null
  try {
    const session = await requireStaff()
    const actor = session.user?.email ?? "unknown"
    const [{ source, plan, planToken, existing }, content] = await Promise.all([
      planFromSheet(input.sourceId),
      getContent(),
    ])

    // The import applies exactly what was reviewed, or nothing.
    if (planToken !== input.planToken) return { ok: false, stale: true, error: STALE }

    key = planToken
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
          // Only what the review settled. A row still waiting on a decision is
          // left for the next check, never imported on a guess.
          if (row.bucket !== "ready" && row.bucket !== "warning") continue
          if (row.outcome === "update" && row.safeOnly && row.candidateId && row.changes) {
            // Contact details onto someone registered another way. Their
            // source, stage and seat stay theirs; the row's hash marks this
            // response done so it is not asked about again.
            await tx.delegate.update({
              where: { id: row.candidateId },
              data: { ...row.changes, sourceRowHash: row.rowHash },
            })
            updated++
          } else if (row.outcome === "create" && row.candidate) {
            const d = row.candidate
            await tx.delegate.create({
              data: {
                // The source's own event: loadSource has checked it is the one
                // running now.
                eventId: source.eventId,
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
          .filter((r) => r.bucket === "decision" || r.outcome === "skip-duplicate")
          .map((r) => ({ rowIndex: r.index, reason: (r.errors ?? []).join(" ") || r.decisions.map((d) => d.kind).join(", "), raw: r.raw }))

        const skipped = plan.buckets.skipped
        await tx.delegateImport.update({
          where: { id: importRow.id },
          data: {
            state: "APPLIED",
            rowsCreated: created,
            rowsUpdated: updated,
            rowsSkipped: skipped,
            rowsInvalid: plan.buckets.decision,
            errors: errors.length > 0 ? errors : undefined,
            finishedAt: new Date(),
          },
        })
        await tx.delegateSheetSource.update({ where: { id: source.id }, data: { lastImportedAt: new Date() } })

        return { created, updated, skipped, invalid: plan.buckets.decision }
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
      // preview and import. The whole import rolled back; a fresh check shows
      // that row as a clash.
      return { ok: false, stale: true, error: "Someone registered with one of these emails a moment ago, so nothing was imported. Check again." }
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
