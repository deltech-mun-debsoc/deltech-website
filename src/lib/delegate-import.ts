// Delegate registration via a Google Form response sheet: how one row becomes one
// delegate, and the plan for a whole sheet. Pure -- no Prisma, no fetch -- so
// scripts/check-delegate-import.ts can exercise every rule without a database.
//
// The engine (identity, duplicates, idempotency, manual-edit protection) is shared
// with recruitment in src/lib/sheet-import.ts. What lives here is only what is
// specific to a delegate.

import { committeeKey, normalizeEmail, normalizeName, normalizePhone, resolveCommittee, type CommitteeRef } from "@/lib/intake"
import type { DelegateMapping } from "@/lib/schemas/delegate-import"
import {
  contentHash,
  mappedValue,
  normalizeHeaders,
  planPreparedImport,
  rowHash,
  rowKey,
  type ExistingRecord,
  type ImportPlan,
  type PreparedRow,
  type RowOutcome,
  type RowPlan,
} from "@/lib/sheet-import"

// What a row becomes. Institution, isDtu and source are NOT here: they are fixed
// by the sheet the row came from, not by the row, so they are set at apply time
// and are never subject to manual-edit protection.
export interface MappedDelegate {
  fullName: string
  email: string
  whatsapp: string
  rollNumber: string | null
  munExperience: string | null
  pref1CommitteeId: string | null
  pref1Portfolio: string | null
  pref2CommitteeId: string | null
  pref2Portfolio: string | null
  query: string | null
}

// A delegate that already exists. `sourceSheetKey` and `status` let the planner
// tell "this person, from this form" apart from "this email, registered some
// other way", which must not be quietly merged.
export interface ExistingDelegate extends ExistingRecord {
  sourceSheetKey: string | null
  status: string
  // Shown beside an incoming response that clashes with this person, and used to
  // spot the same student under a different email.
  fullName?: string
  source?: string
  seat?: string | null
  rollNumber?: string | null
  whatsapp?: string
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------
//
// The review is organised around what the organiser has to do, not what the
// planner did. A row that needs a person is held back from import until it has
// an answer, and the answers are kept on the source (DelegateSheetSource.
// resolutions), so a routine check never asks the same question twice.

export type RowResolution = "skip" | "import" | "safe-fields" | { email: string }

export interface Resolutions {
  // committeeKey(answer) -> committee id, or null to leave the choice empty.
  committees: Record<string, string | null>
  // rowHash -> what to do with that one response.
  rows: Record<string, RowResolution>
  // email -> rowHash of the submission to keep instead of the latest.
  keep: Record<string, string>
}

export function parseResolutions(raw: unknown): Resolutions {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, never>) : {})
  return { committees: rec(o.committees), rows: rec(o.rows), keep: rec(o.keep) }
}

export type Decision =
  // A committee answer that matches none, or more than one, committee.
  | { kind: "committee"; answer: string; key: string; label: string; candidates: { id: string; name: string }[]; ambiguous: boolean }
  // The email already belongs to someone registered another way.
  | { kind: "identity"; existing: { id: string; email: string; name: string | null; source: string | null; status: string; seat: string | null } }
  // Same roll number or phone as someone else, under a different email.
  | { kind: "possible-duplicate"; by: "roll number" | "phone"; value: string; others: { name: string | null; email: string; registered: boolean }[] }
  // Missing or broken required answers: fixed in the sheet, or skipped.
  | { kind: "invalid" }

export type Bucket = "ready" | "decision" | "warning" | "skipped"

export interface DelegateRowPlan extends Omit<RowPlan<MappedDelegate>, "outcome"> {
  // "skip-kept": the organiser chose to keep what exists and skip this response.
  outcome: RowOutcome | "skip-kept"
  bucket: Bucket
  decisions: Decision[]
  // An update limited to contact details, onto someone registered another way.
  safeOnly?: boolean
}

export interface DelegatePlan extends Omit<ImportPlan<MappedDelegate>, "rows"> {
  rows: DelegateRowPlan[]
  buckets: Record<Bucket, number>
}

// The only fields an import may write onto someone registered another way:
// contact details. Never status, seat or choices.
export const SAFE_FIELDS = ["whatsapp", "rollNumber", "munExperience", "query"] as const

// ---------------------------------------------------------------------------
// Field rules
// ---------------------------------------------------------------------------

// DTU roll numbers look like 2K23/CO/123 (older batches) or 23/CO/123. The form
// only says "DTU Official Format", so this is a HEURISTIC: a roll number that
// doesn't match is a warning an organiser reviews, never a rejection. Tighten it
// if the exact official pattern is known.
const DTU_ROLL = /^(?:2K)?\d{2}\/[A-Z]{1,5}\d{0,2}\/\d{1,4}$/

export function normalizeRollNumber(raw: string | undefined): string | null {
  if (!raw) return null
  const tidy = raw.toUpperCase().replace(/\s+/g, "").replace(/[-\\]/g, "/")
  return tidy || null
}

export function looksLikeDtuRollNumber(roll: string | null): boolean {
  return !!roll && DTU_ROLL.test(roll)
}

// "N.A.", "none", "-": the form asks for N.A. when there is no experience. These
// are not experience, and storing them would make every delegate look seasoned.
const NO_EXPERIENCE = /^(n\.?\s*a\.?|na|none|nil|no|nothing|not applicable|-+|0)$/i

export function munExperienceFrom(before: string | undefined, experience: string | undefined): string | null {
  const text = experience?.trim()
  if (text && !NO_EXPERIENCE.test(text)) return text
  // "Yes" with no usable description still tells an organiser something.
  if (before && /^y/i.test(before.trim())) return "Yes"
  return null
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

export function prepareDelegateRow(
  raw: Record<string, unknown>,
  mapping: DelegateMapping,
  index: number,
  committees: CommitteeRef[],
  resolved: Resolutions["committees"] = {},
): PreparedRow<MappedDelegate> & { decisions: Decision[] } {
  const row = normalizeHeaders(raw)
  const errors: string[] = []
  const warnings: string[] = []
  const get = (field: keyof DelegateMapping) => mappedValue(row, mapping, field)

  const rawName = get("fullName")
  const rawEmail = get("email")
  const rawPhone = get("whatsapp")

  if (!rawName) errors.push("Missing full name.")
  if (!rawEmail) errors.push("Missing email address.")
  // Delegate.whatsapp is required. A missing phone almost always means the column
  // mapping is wrong, which is exactly when an organiser needs to see it.
  if (!rawPhone) errors.push("Missing phone number.")

  const email = rawEmail ? normalizeEmail(rawEmail) : ""
  if (rawEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push(`"${rawEmail}" is not a valid email address.`)
  }

  // A malformed phone is kept as typed rather than rejected: losing a
  // registration over formatting is worse than an organiser fixing a number.
  const phone = normalizePhone(rawPhone)
  if (rawPhone && !phone) warnings.push(`Phone "${rawPhone}" doesn't look like a 10-digit number; kept as typed.`)

  const rollNumber = normalizeRollNumber(get("rollNumber"))
  if (mapping.rollNumber) {
    if (!rollNumber) warnings.push("No roll number given.")
    else if (!looksLikeDtuRollNumber(rollNumber)) {
      warnings.push(`Roll number "${rollNumber}" doesn't look like a DTU roll number. Check this person is a DTU student.`)
    }
  }

  // A committee answer that matches nothing, or more than one committee, is a
  // question for the organiser, answered once per distinct answer. Never settled
  // by guessing, and never silently left empty.
  const decisions: Decision[] = []
  const committee = (field: "pref1Committee" | "pref2Committee", label: string) => {
    const text = get(field)
    if (!text) return null
    const key = committeeKey(text)
    if (key in resolved) return resolved[key]
    const r = resolveCommittee(text, committees)
    if (r.kind === "match") return r.committee.id
    const candidates = (r.kind === "ambiguous" ? r.candidates : r.suggestions).map((c) => ({ id: c.id, name: c.name }))
    decisions.push({ kind: "committee", answer: text, key, label, candidates, ambiguous: r.kind === "ambiguous" })
    return null
  }
  const pref1CommitteeId = committee("pref1Committee", "first committee")
  const pref2CommitteeId = committee("pref2Committee", "second committee")

  const candidate: MappedDelegate | null =
    errors.length === 0
      ? {
          fullName: normalizeName(rawName!),
          email,
          whatsapp: phone ?? (rawPhone ?? "").trim(),
          rollNumber,
          munExperience: munExperienceFrom(get("munBefore"), get("munExperience")),
          pref1CommitteeId,
          pref1Portfolio: get("pref1Portfolio") ?? null,
          pref2CommitteeId,
          pref2Portfolio: get("pref2Portfolio") ?? null,
          query: get("query") ?? null,
        }
      : null

  return {
    index,
    raw: row,
    rowKey: rowKey(row, mapping, index, normalizeEmail),
    rowHash: rowHash(row),
    candidate,
    errors,
    decisions,
    ...(warnings.length ? { warnings } : {}),
  }
}

// ---------------------------------------------------------------------------
// The whole sheet
// ---------------------------------------------------------------------------

export function planDelegateImport(
  rawRows: Record<string, unknown>[],
  mapping: DelegateMapping,
  args: {
    // The tab being imported. Only delegates from THIS tab are candidates for an
    // update; everything else is checked for a clash instead.
    sheetKey: string
    existing: ExistingDelegate[]
    committees: CommitteeRef[]
    resolutions?: Resolutions
  },
): DelegatePlan {
  const res = args.resolutions ?? { committees: {}, rows: {}, keep: {} }
  const fromThisSheet = args.existing.filter((e) => e.sourceSheetKey === args.sheetKey)
  const elsewhere = new Map(
    args.existing
      .filter((e) => e.sourceSheetKey !== args.sheetKey)
      .map((e) => [e.email.toLowerCase(), e]),
  )
  // A response whose exact content was already written somewhere (a contact
  // correction onto another registration) is done.
  const appliedHashes = new Set(args.existing.map((e) => e.sourceRowHash).filter(Boolean))

  const prepared = rawRows.map((raw, i) => {
    // The row's identity is its content as it sits in the sheet, kept even when
    // the organiser corrects the email, so the correction stays attached to it.
    const hash = rowHash(normalizeHeaders(raw))
    const fix = res.rows[hash]
    let input = raw
    if (fix && typeof fix === "object" && mapping.email) {
      const header = Object.keys(raw).find((k) => k.trim().toLowerCase() === mapping.email.trim().toLowerCase()) ?? mapping.email
      input = { ...raw, [header]: fix.email }
    }
    const p = prepareDelegateRow(input, mapping, i, args.committees, res.committees)
    return { ...p, rowHash: hash }
  })
  const byIndex: Record<string, number> = {}
  for (const [email, hash] of Object.entries(res.keep)) {
    const row = prepared.find((p) => p.rowHash === hash && p.candidate?.email.toLowerCase() === email.toLowerCase())
    if (row) byIndex[email.toLowerCase()] = row.index
  }
  const base = planPreparedImport(prepared, mapping, fromThisSheet, byIndex)

  const rows: DelegateRowPlan[] = base.rows.map((r) => ({ ...r, bucket: "ready", decisions: [...prepared[r.index].decisions] }))

  for (const row of rows) {
    const choice = res.rows[row.rowHash]
    if (row.outcome === "invalid") {
      row.decisions = choice === "skip" ? [] : [{ kind: "invalid" }]
      continue
    }
    if (row.outcome !== "create" || !row.candidate) continue

    if (appliedHashes.has(row.rowHash)) {
      row.outcome = "skip-unchanged"
      row.decisions = []
      continue
    }

    // Email is unique per event. A row whose email already belongs to someone
    // registered another way (the website, a cross delegation, another Form)
    // is never merged into them: their stage and seat belong to that other
    // registration. The organiser decides.
    const clash = elsewhere.get(row.candidate.email.toLowerCase())
    if (clash) {
      if (choice === "skip") {
        row.outcome = "skip-kept"
        row.decisions = []
      } else if (choice === "safe-fields") {
        const locked = new Set(clash.manualEditedFields)
        const changes: Partial<MappedDelegate> = {}
        for (const f of SAFE_FIELDS) {
          const v = row.candidate[f]
          if (v !== null && v !== undefined && v !== "" && !locked.has(f)) (changes as Record<string, unknown>)[f] = v
        }
        row.outcome = "update"
        row.candidateId = clash.id
        row.changes = changes
        row.protectedFields = SAFE_FIELDS.filter((f) => locked.has(f))
        row.safeOnly = true
        row.decisions = []
      } else {
        row.changes = undefined
        row.decisions.push({
          kind: "identity",
          existing: {
            id: clash.id,
            email: clash.email,
            name: clash.fullName ?? null,
            source: clash.source ?? null,
            status: clash.status,
            seat: clash.seat ?? null,
          },
        })
      }
    }
  }

  // The same student under two emails: same roll number or phone. Flagged on
  // new rows only, never merged.
  const people: { index: number | null; email: string; name: string | null; roll: string | null; phone: string | null }[] = [
    ...rows
      .filter((r) => (r.outcome === "create" || r.outcome === "update") && r.candidate)
      .map((r) => ({ index: r.index as number | null, email: r.candidate!.email, name: r.candidate!.fullName, roll: r.candidate!.rollNumber, phone: normalizePhone(r.candidate!.whatsapp) ?? null })),
    ...args.existing.map((e) => ({ index: null, email: e.email.toLowerCase(), name: e.fullName ?? null, roll: e.rollNumber ?? null, phone: e.whatsapp ? (normalizePhone(e.whatsapp) ?? null) : null })),
  ]
  for (const row of rows) {
    if (row.outcome !== "create" || !row.candidate || row.decisions.length > 0) continue
    const choice = res.rows[row.rowHash]
    if (choice === "import") continue
    const me = row.candidate
    const phone = normalizePhone(me.whatsapp) ?? null
    const sameRoll = me.rollNumber ? people.filter((p) => p.index !== row.index && p.email !== me.email && p.roll === me.rollNumber) : []
    const samePhone = phone ? people.filter((p) => p.index !== row.index && p.email !== me.email && p.phone === phone) : []
    const [by, value, others] = sameRoll.length
      ? (["roll number", me.rollNumber!, sameRoll] as const)
      : samePhone.length
        ? (["phone", me.whatsapp, samePhone] as const)
        : [null, "", []]
    if (!by) continue
    if (choice === "skip") {
      row.outcome = "skip-kept"
      continue
    }
    row.decisions.push({
      kind: "possible-duplicate",
      by,
      value,
      others: others.map((o) => ({ name: o.name, email: o.email, registered: o.index === null })),
    })
  }

  for (const row of rows) {
    row.bucket =
      row.decisions.length > 0
        ? "decision"
        : row.outcome === "create" || row.outcome === "update"
          ? (row.warnings?.length ?? 0) > 0
            ? "warning"
            : "ready"
          : "skipped"
  }

  const count = (o: string) => rows.filter((r) => r.outcome === o).length
  const bucket = (b: Bucket) => rows.filter((r) => r.bucket === b).length
  return {
    rows,
    duplicateGroups: base.duplicateGroups,
    counts: {
      total: rows.length,
      create: count("create"),
      update: count("update"),
      skipUnchanged: count("skip-unchanged"),
      skipDuplicate: count("skip-duplicate") + count("skip-kept"),
      invalid: count("invalid"),
    },
    buckets: { ready: bucket("ready"), decision: bucket("decision"), warning: bucket("warning"), skipped: bucket("skipped") },
  }
}

// What an organiser approved, as one hash: this event, this source, this
// mapping, this exact sheet content and these choices. Preview hands it out,
// import recomputes it from a fresh read and refuses on any difference, so
// Import applies exactly what was reviewed. Applying the same plan twice is a
// no-op, keyed on the same hash.
export function delegateImportIdempotencyKey(args: {
  eventId: string
  sourceId: string
  mapping: DelegateMapping
  rows: Record<string, string>[]
  resolutions?: Resolutions
}): string {
  return contentHash({
    kind: "delegate",
    eventId: args.eventId,
    sourceId: args.sourceId,
    mapping: args.mapping,
    rows: args.rows,
    resolutions: args.resolutions ?? {},
  })
}

// The rows an organiser should look at before or after applying.
export function rowsNeedingAttention(plan: DelegatePlan) {
  return plan.rows.filter((r) => r.bucket === "decision" || r.bucket === "warning")
}
