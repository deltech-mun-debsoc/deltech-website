// Delegate registration via a Google Form response sheet: how one row becomes one
// delegate, and the plan for a whole sheet. Pure -- no Prisma, no fetch -- so
// scripts/check-delegate-import.ts can exercise every rule without a database.
//
// The engine (identity, duplicates, idempotency, manual-edit protection) is shared
// with recruitment in src/lib/sheet-import.ts. What lives here is only what is
// specific to a delegate.

import { matchCommittee, normalizeEmail, normalizeName, normalizePhone, type CommitteeRef } from "@/lib/intake"
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
}

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
): PreparedRow<MappedDelegate> {
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

  // A committee choice that matches nothing is surfaced, not silently dropped.
  // The fix is usually an alias in Config -> Committees, then Refetch.
  const committee = (field: "pref1Committee" | "pref2Committee", label: string) => {
    const text = get(field)
    if (!text) return null
    const hit = matchCommittee(text, committees)
    if (!hit) warnings.push(`${label} "${text}" doesn't match any committee, so it was left empty.`)
    return hit?.id ?? null
  }
  const pref1CommitteeId = committee("pref1Committee", "First committee")
  const pref2CommitteeId = committee("pref2Committee", "Second committee")

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
    overrides?: Record<string, number>
  },
): ImportPlan<MappedDelegate> {
  const fromThisSheet = args.existing.filter((e) => e.sourceSheetKey === args.sheetKey)
  const elsewhere = new Map(
    args.existing
      .filter((e) => e.sourceSheetKey !== args.sheetKey)
      .map((e) => [e.email.toLowerCase(), e]),
  )

  const prepared = rawRows.map((raw, i) => prepareDelegateRow(raw, mapping, i, args.committees))
  const plan = planPreparedImport(prepared, mapping, fromThisSheet, args.overrides ?? {})

  // Email is unique across ALL delegates. A row whose email already belongs to
  // someone registered another way -- the website, a cross-delegation import, a
  // previous event -- cannot be created, and must not be silently merged into
  // that person either: their status and allotment belong to a different
  // registration. Show it, and let an organiser decide.
  for (const row of plan.rows) {
    if (row.outcome !== "create" || !row.candidate) continue
    const clash = elsewhere.get(row.candidate.email.toLowerCase())
    if (!clash) continue
    row.outcome = "invalid"
    row.changes = undefined
    row.errors = [
      `${row.candidate.email} is already registered another way (status: ${clash.status.toLowerCase().replace(/_/g, " ")}). ` +
        `Not imported. Remove the old registration first, or close the previous event.`,
    ]
  }

  const count = (o: string) => plan.rows.filter((r) => r.outcome === o).length
  plan.counts = {
    total: plan.rows.length,
    create: count("create"),
    update: count("update"),
    skipUnchanged: count("skip-unchanged"),
    skipDuplicate: count("skip-duplicate"),
    invalid: count("invalid"),
  }
  return plan
}

// Applying the same sheet content with the same mapping twice is a no-op.
export function delegateImportIdempotencyKey(args: {
  sourceId: string
  mapping: DelegateMapping
  rows: Record<string, string>[]
  overrides?: Record<string, number>
}): string {
  return contentHash({
    kind: "delegate",
    sourceId: args.sourceId,
    mapping: args.mapping,
    rows: args.rows,
    overrides: args.overrides ?? {},
  })
}

// The rows an organiser should look at before or after applying.
export function rowsNeedingAttention(plan: ImportPlan<MappedDelegate>) {
  return plan.rows.filter((r) => r.outcome === "invalid" || (r.warnings?.length ?? 0) > 0)
}
