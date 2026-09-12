// Google Sheets response import for recruitment candidates.
//
// The engine -- row identity, duplicate resolution, idempotency, manual-edit
// protection -- lives in src/lib/sheet-import.ts, shared with delegate
// registration. What remains here is what is specific to a candidate: which
// fields exist and how one row becomes one. This module's exported API is
// unchanged from before the split, and scripts/check-recruitment-import.ts pins it.
//
// Reuses the existing intake normalizers (src/lib/intake.ts) and the Google Sheets
// URL derivation (src/lib/gsheet-url.ts) rather than reinventing either.

import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/intake"
import type { CandidateMapping } from "@/lib/schemas/recruitment"
import {
  contentHash,
  mappedValue,
  normalizeHeaders,
  planPreparedImport,
  rowHash,
  rowKey as sharedRowKey,
  withheldManualEdits as sharedWithheldManualEdits,
  type DuplicateGroup,
  type ExistingRecord,
  type ImportPlan as SharedImportPlan,
  type PreparedRow as SharedPreparedRow,
  type RowOutcome,
  type RowPlan as SharedRowPlan,
} from "@/lib/sheet-import"

export { normalizeHeaders, parseRowTimestamp, rowHash, sheetKeyFromUrl, summarisePlan } from "@/lib/sheet-import"
export type { DuplicateGroup, RowOutcome }

// The stable identity of a response row within its source: see sheet-import.ts.
export function rowKey(row: Record<string, string>, mapping: CandidateMapping, index: number): string {
  return sharedRowKey(row, mapping, index, normalizeEmail)
}

// The idempotency key for an entire apply. Applying the same sheet content with
// the same mapping to the same source twice is a no-op that returns the first
// result: this is what makes a double-click or a network retry harmless.
//
// The hashed object's shape is load-bearing: keys already stored in
// RecruitmentImport.idempotencyKey were computed from exactly these fields, so a
// rename here would make every previously applied sheet look new.
export function importIdempotencyKey(args: {
  cycleId: string
  sourceId: string
  mapping: CandidateMapping
  rows: Record<string, string>[]
  // Part of the key: choosing a different submission for a duplicate is a
  // different import, and must not be swallowed as a repeat of the first one.
  overrides?: Record<string, number>
}): string {
  return contentHash({
    cycleId: args.cycleId,
    sourceId: args.sourceId,
    mapping: args.mapping,
    rows: args.rows,
    overrides: args.overrides ?? {},
  })
}

export interface MappedCandidate {
  fullName: string
  email: string
  phone: string | null
  year: string | null
  branch: string | null
}

export type PreparedRow = SharedPreparedRow<MappedCandidate>
export type ExistingCandidate = ExistingRecord
export type RowPlan = SharedRowPlan<MappedCandidate>
export type ImportPlan = SharedImportPlan<MappedCandidate>

// Turn one sheet row into a candidate, collecting every validation problem rather
// than throwing on the first. Invalid rows are surfaced to the operator, never
// dropped silently.
export function prepareRow(
  raw: Record<string, unknown>,
  mapping: CandidateMapping,
  index: number,
): PreparedRow {
  const row = normalizeHeaders(raw)
  const errors: string[] = []

  const rawName = mappedValue(row, mapping, "fullName")
  const rawEmail = mappedValue(row, mapping, "email")

  if (!rawName) errors.push("Missing full name.")
  if (!rawEmail) errors.push("Missing email address.")

  const email = rawEmail ? normalizeEmail(rawEmail) : ""
  if (rawEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push(`"${rawEmail}" is not a valid email address.`)
  }

  const candidate: MappedCandidate | null =
    errors.length === 0
      ? {
          fullName: normalizeName(rawName!),
          email,
          phone: normalizePhone(mappedValue(row, mapping, "phone")) ?? null,
          year: mappedValue(row, mapping, "year") ?? null,
          branch: mappedValue(row, mapping, "branch") ?? null,
        }
      : null

  return { index, raw: row, rowKey: rowKey(row, mapping, index), rowHash: rowHash(row), candidate, errors }
}

export function planImport(
  rawRows: Record<string, unknown>[],
  mapping: CandidateMapping,
  existing: ExistingCandidate[],
  // Per-email row index the operator picked, overriding the automatic choice.
  overrides: Record<string, number> = {},
): ImportPlan {
  const prepared = rawRows.map((raw, i) => prepareRow(raw, mapping, i))
  return planPreparedImport(prepared, mapping, existing, overrides)
}

// "Never silently overwrite manually edited candidate data", and report what was
// withheld so the operator can see it.
export function withheldManualEdits(
  candidate: MappedCandidate,
  manualEditedFields: string[],
): { changes: Partial<MappedCandidate>; protectedFields: string[] } {
  return sharedWithheldManualEdits(candidate, manualEditedFields)
}
