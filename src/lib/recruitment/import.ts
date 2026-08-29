// Google Sheets response import. The decision logic is pure and lives here so
// scripts/check-recruitment-import.ts can exercise duplicate detection, row
// identity, manual-edit protection and idempotency without a database or a
// network call. The Prisma/fetch half lives in the recruitment import actions.
//
// Reuses the existing intake normalizers (src/lib/intake.ts) and the Google Sheets
// URL derivation (src/lib/gsheet-url.ts) rather than reinventing either.

import { createHash } from "node:crypto"
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/intake"
import type { CandidateFieldKey, CandidateMapping } from "@/lib/schemas/recruitment"

// ---------------------------------------------------------------------------
// Source identity
// ---------------------------------------------------------------------------

// "<spreadsheetId>:<gid>": the stable identity of a source tab, stored on every
// candidate the tab produced. Two different tabs of the same workbook are
// different sources, because their row numbering is independent.
export function sheetKeyFromUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  // Published-to-web links expose a token rather than the document id.
  const published = trimmed.match(/\/spreadsheets\/d\/e\/([\w-]+)/)
  if (published) return `pub-${published[1]}:0`

  const doc = trimmed.match(/\/spreadsheets\/d\/([\w-]+)/)
  if (!doc) return null
  const gid = trimmed.match(/[#?&]gid=(\d+)/)
  return `${doc[1]}:${gid ? gid[1] : "0"}`
}

// ---------------------------------------------------------------------------
// Row identity
// ---------------------------------------------------------------------------

// The stable identity of a response row within its source. Email is preferred,
// it survives the sheet being re-sorted or rows being inserted above, which a row
// number does not. A row with no usable email falls back to a hash of its content
// plus its position, which is the best available and still stable for re-import
// of an unchanged sheet.
export function rowKey(row: Record<string, string>, mapping: CandidateMapping, index: number): string {
  const email = mappedValue(row, mapping, "email")
  if (email) return `email:${normalizeEmail(email)}`
  return `row:${index}:${contentHash(row).slice(0, 16)}`
}

// Detects whether a row's content changed since the last import, so an unchanged
// row can be skipped rather than rewritten (which would churn updatedAt on every
// re-import and make the audit trail useless).
export function rowHash(row: Record<string, string>): string {
  return contentHash(row)
}

function contentHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

// Key order in a sheet-derived object is incidental; sort so the hash is stable.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`
}

// The idempotency key for an entire apply. Applying the same sheet content with
// the same mapping to the same source twice is a no-op that returns the first
// result: this is what makes a double-click or a network retry harmless.
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

// ---------------------------------------------------------------------------
// Mapping and normalisation
// ---------------------------------------------------------------------------

// Sheet headers arrive with stray whitespace and inconsistent case. Normalise the
// row once so the mapping can be matched leniently.
export function normalizeHeaders(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    out[key.trim()] = String(value ?? "").trim()
  }
  return out
}

function mappedValue(
  row: Record<string, string>,
  mapping: CandidateMapping,
  field: CandidateFieldKey,
): string | undefined {
  const header = mapping[field]
  if (!header) return undefined
  // Exact header first, then a case/whitespace-insensitive match, so a sheet whose
  // header casing changed doesn't silently drop a mapped column.
  if (row[header] !== undefined && row[header] !== "") return row[header]
  const wanted = header.trim().toLowerCase()
  const found = Object.keys(row).find((k) => k.trim().toLowerCase() === wanted)
  return found && row[found] !== "" ? row[found] : undefined
}

export interface MappedCandidate {
  fullName: string
  email: string
  phone: string | null
  year: string | null
  branch: string | null
}

export interface PreparedRow {
  index: number
  raw: Record<string, string>
  rowKey: string
  rowHash: string
  candidate: MappedCandidate | null
  errors: string[]
}

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

// ---------------------------------------------------------------------------
// Duplicate detection and the per-row plan
// ---------------------------------------------------------------------------

export type RowOutcome = "create" | "update" | "skip-unchanged" | "skip-duplicate" | "invalid"

// A group of rows in one sheet that resolve to the same person, newest first when
// a timestamp column is mapped. Surfaced to the operator so the losing submissions
// are visible and overridable, rather than silently discarded.
export interface DuplicateGroup {
  email: string
  // Row indexes in the order they were considered: the winner first.
  rowIndexes: number[]
  winnerIndex: number
  // True when the winner was chosen by timestamp rather than sheet position.
  byTimestamp: boolean
}

// Parses a Google Forms timestamp. Sheets export as locale strings and the exact
// format varies by spreadsheet, so anything unparseable is reported as null and
// the caller falls back to sheet order rather than guessing a date.
export function parseRowTimestamp(value: string | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  // Google Sheets exports a locale string, and the CSV reader may reformat it
  // further (dropping the time, shortening the year). Parse the parts explicitly
  // rather than trusting Date.parse, which reads "8/9/2026" as August 9th in one
  // locale and September 8th in another: a silent month/day swap would pick the
  // wrong submission for 12 days a year.
  const m = trimmed.match(
    /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  )
  if (m) {
    const [, a, b, c, hh = "0", mm = "0", ss = "0"] = m
    let year: number, month: number, day: number

    if (a.length === 4) {
      // ISO-ish: YYYY-MM-DD
      year = Number(a)
      month = Number(b)
      day = Number(c)
    } else {
      // Google's US default for this export is M/D/YYYY. A value > 12 in the
      // first position can only be a day, so it disambiguates itself.
      year = Number(c)
      if (Number(a) > 12) {
        day = Number(a)
        month = Number(b)
      } else {
        month = Number(a)
        day = Number(b)
      }
    }

    // Two-digit years come back from some readers as "26" meaning 2026.
    if (year < 100) year += 2000
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const parsed = Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss))
      return Number.isNaN(parsed) ? null : parsed
    }
  }

  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}


export interface ExistingCandidate {
  id: string
  email: string
  sourceRowKey: string | null
  sourceRowHash: string | null
  manualEditedFields: string[]
}

export interface RowPlan {
  index: number
  rowKey: string
  rowHash: string
  outcome: RowOutcome
  candidateId?: string
  // Only the fields that will actually be written. Fields a human edited by hand
  // are removed here, so an import can never silently clobber manual work.
  changes?: Partial<MappedCandidate>
  protectedFields?: string[]
  errors?: string[]
  raw: Record<string, string>
  candidate: MappedCandidate | null
}

export interface ImportPlan {
  rows: RowPlan[]
  counts: Record<"total" | "create" | "update" | "skipUnchanged" | "skipDuplicate" | "invalid", number>
  // One entry per email that appeared more than once, so the preview can show the
  // submissions that lost and let the operator pick a different one.
  duplicateGroups: DuplicateGroup[]
}

// Build the full plan for an import. Pure: callers pass in what already exists,
// so this is exhaustively testable and the preview the operator approves is
// literally the plan that gets applied.

// Decide which row wins for each email, and describe the losers.
//
// Order of authority: an explicit operator override, then the newest mapped
// timestamp, then the LAST row in the sheet. Last-wins is the right fallback for a
// form response sheet, where rows are appended in submission order, so a
// resubmission supersedes the original instead of being discarded.
function resolveDuplicates(
  prepared: PreparedRow[],
  mapping: CandidateMapping,
  overrides: Record<string, number>,
): { winners: Map<string, number>; duplicateGroups: DuplicateGroup[] } {
  const groups = new Map<string, number[]>()
  for (const row of prepared) {
    if (!row.candidate) continue
    const email = row.candidate.email.toLowerCase()
    const list = groups.get(email)
    if (list) list.push(row.index)
    else groups.set(email, [row.index])
  }

  const winners = new Map<string, number>()
  const duplicateGroups: DuplicateGroup[] = []

  for (const [email, indexes] of groups) {
    if (indexes.length === 1) {
      winners.set(email, indexes[0])
      continue
    }

    const stamps = new Map(
      indexes.map((i) => [i, parseRowTimestamp(mappedValue(prepared[i].raw, mapping, "timestamp"))]),
    )
    const dated = indexes.filter((i) => stamps.get(i) !== null)

    let winner: number
    let byTimestamp = false

    const override = overrides[email]
    if (override !== undefined && indexes.includes(override)) {
      winner = override
    } else if (dated.length > 0) {
      // Newest wins. Ties fall back to the later row, matching the no-timestamp rule.
      winner = dated.reduce((best, i) => (stamps.get(i)! >= stamps.get(best)! ? i : best), dated[0])
      byTimestamp = true
    } else {
      winner = indexes[indexes.length - 1]
    }

    winners.set(email, winner)
    duplicateGroups.push({
      email,
      // Winner first so the preview can show it as the kept row.
      rowIndexes: [winner, ...indexes.filter((i) => i !== winner)],
      winnerIndex: winner,
      byTimestamp,
    })
  }

  return { winners, duplicateGroups }
}

export function planImport(
  rawRows: Record<string, unknown>[],
  mapping: CandidateMapping,
  existing: ExistingCandidate[],
  // Per-email row index the operator picked, overriding the automatic choice.
  overrides: Record<string, number> = {},
): ImportPlan {
  const byEmail = new Map(existing.map((e) => [e.email.toLowerCase(), e]))
  const byRowKey = new Map(existing.filter((e) => e.sourceRowKey).map((e) => [e.sourceRowKey!, e]))

  // First pass: prepare every row, so duplicates can be resolved against the whole
  // sheet rather than in arrival order. The old single pass kept whichever row came
  // FIRST, which on a Google Form response sheet is the OLDEST submission: someone
  // who resubmitted to correct their answers had the correction thrown away.
  const prepared = rawRows.map((raw, i) => prepareRow(raw, mapping, i))

  const { winners, duplicateGroups } = resolveDuplicates(prepared, mapping, overrides)

  const rows: RowPlan[] = []

  for (let i = 0; i < prepared.length; i++) {
    const prepared_ = prepared[i]
    const base = {
      index: prepared_.index,
      rowKey: prepared_.rowKey,
      rowHash: prepared_.rowHash,
      raw: prepared_.raw,
      candidate: prepared_.candidate,
    }

    if (!prepared_.candidate) {
      rows.push({ ...base, outcome: "invalid", errors: prepared_.errors })
      continue
    }

    const identity = prepared_.candidate.email.toLowerCase()
    if (winners.get(identity) !== i) {
      const group = duplicateGroups.find((g) => g.email === identity)
      const winnerRow = group ? prepared[group.winnerIndex] : undefined
      rows.push({
        ...base,
        outcome: "skip-duplicate",
        errors: [
          group?.byTimestamp
            ? `Superseded by a later submission from ${prepared_.candidate.email} (row ${(winnerRow?.index ?? 0) + 1}).`
            : `Duplicate of another row in this sheet (${prepared_.candidate.email}).`,
        ],
      })
      continue
    }

    const match = byRowKey.get(prepared_.rowKey) ?? byEmail.get(identity)

    if (!match) {
      rows.push({ ...base, outcome: "create", changes: prepared_.candidate })
      continue
    }

    // Unchanged content and same source row → nothing to do. Re-importing a sheet
    // nobody edited must be a genuine no-op.
    if (match.sourceRowHash === prepared_.rowHash) {
      rows.push({ ...base, outcome: "skip-unchanged", candidateId: match.id })
      continue
    }

    const { changes, protectedFields } = withheldManualEdits(prepared_.candidate, match.manualEditedFields)
    rows.push({
      ...base,
      outcome: "update",
      candidateId: match.id,
      changes,
      protectedFields,
    })
  }

  const counts = {
    total: rows.length,
    create: rows.filter((r) => r.outcome === "create").length,
    update: rows.filter((r) => r.outcome === "update").length,
    skipUnchanged: rows.filter((r) => r.outcome === "skip-unchanged").length,
    skipDuplicate: rows.filter((r) => r.outcome === "skip-duplicate").length,
    invalid: rows.filter((r) => r.outcome === "invalid").length,
  }

  return { rows, counts, duplicateGroups }
}

// Strip fields a human edited by hand. "Never silently overwrite manually edited
// candidate data", and report what was withheld so the operator can see it.
export function withheldManualEdits(
  candidate: MappedCandidate,
  manualEditedFields: string[],
): { changes: Partial<MappedCandidate>; protectedFields: string[] } {
  const locked = new Set(manualEditedFields)
  const changes: Partial<MappedCandidate> = {}
  const protectedFields: string[] = []

  for (const [key, value] of Object.entries(candidate) as [keyof MappedCandidate, never][]) {
    if (locked.has(key)) protectedFields.push(key)
    else changes[key] = value
  }

  // The email is a candidate's identity within a cycle. Changing it via import
  // would move the row onto a different person, so it is never an update target.
  delete changes.email

  return { changes, protectedFields }
}

// Human-readable summary for the preview panel and the audit meta.
export function summarisePlan(plan: ImportPlan): string {
  const c = plan.counts
  return [
    `${c.total} rows`,
    `${c.create} new`,
    `${c.update} updated`,
    `${c.skipUnchanged} unchanged`,
    `${c.skipDuplicate} duplicate`,
    `${c.invalid} invalid`,
  ].join(" · ")
}
