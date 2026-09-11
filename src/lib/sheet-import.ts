// Google Sheets response import: the part that does not care WHAT is being
// imported.
//
// This was written for recruitment (src/lib/recruitment/import.ts) and is shared
// now that delegate registration for the Intra MUN arrives the same way: a Google
// Form writes a response sheet, an operator pastes its link, previews, applies,
// and refetches as submissions come in. Both importers need the same guarantees,
// and they are subtle enough that two copies would drift:
//
//   - a row is identified by its email, so re-sorting the sheet or inserting a row
//     above it does not turn one person into two
//   - when someone submits twice, the NEWEST submission wins, and the losing rows
//     stay visible so an operator can pick a different one
//   - applying the same sheet twice is a no-op
//   - a field a human edited by hand is never silently overwritten
//   - invalid rows are shown, never dropped
//
// Everything here is pure: no Prisma, no fetch. Callers pass in what already
// exists, so the preview an operator approves is literally the plan that runs, and
// scripts can exercise every rule without a database.

import { createHash } from "node:crypto"

// { recordField: sheetColumnHeader }. Only the email is required of every
// importer, because it is the identity.
export type SheetMapping = { email: string; timestamp?: string } & Record<string, string | undefined>

// ---------------------------------------------------------------------------
// Source identity
// ---------------------------------------------------------------------------

// "<spreadsheetId>:<gid>": the stable identity of a source tab. Two different tabs
// of the same workbook are different sources, because their row numbering is
// independent.
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
// Hashing
// ---------------------------------------------------------------------------

export function contentHash(value: unknown): string {
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

// Detects whether a row's content changed since the last import, so an unchanged
// row can be skipped rather than rewritten (which would churn updatedAt on every
// re-import and make the audit trail useless).
export function rowHash(row: Record<string, string>): string {
  return contentHash(row)
}

// ---------------------------------------------------------------------------
// Mapping
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

export function mappedValue(
  row: Record<string, string>,
  mapping: Record<string, string | undefined>,
  field: string,
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

// The stable identity of a response row within its source. Email is preferred: it
// survives the sheet being re-sorted or rows being inserted above, which a row
// number does not. A row with no usable email falls back to a hash of its content
// plus its position, which is only ever used to key an invalid row.
export function rowKey(
  row: Record<string, string>,
  mapping: SheetMapping,
  index: number,
  normalizeEmail: (s: string) => string,
): string {
  const email = mappedValue(row, mapping, "email")
  if (email) return `email:${normalizeEmail(email)}`
  return `row:${index}:${contentHash(row).slice(0, 16)}`
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type RowOutcome = "create" | "update" | "skip-unchanged" | "skip-duplicate" | "invalid"

// One sheet row after mapping. `candidate` is the mapped record, or null when the
// row is invalid (the name predates delegates sharing this engine; it means
// "the thing this row would become").
export interface PreparedRow<T extends { email: string }> {
  index: number
  raw: Record<string, string>
  rowKey: string
  rowHash: string
  candidate: T | null
  errors: string[]
  // Problems that do NOT stop the row importing but an operator should see: a
  // roll number that doesn't look like a DTU one, an unknown committee name.
  warnings?: string[]
}

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

export interface ExistingRecord {
  id: string
  email: string
  sourceRowKey: string | null
  sourceRowHash: string | null
  manualEditedFields: string[]
}

export interface RowPlan<T extends { email: string }> {
  index: number
  rowKey: string
  rowHash: string
  outcome: RowOutcome
  candidateId?: string
  // Only the fields that will actually be written. Fields a human edited by hand
  // are removed here, so an import can never silently clobber manual work.
  changes?: Partial<T>
  protectedFields?: string[]
  errors?: string[]
  warnings?: string[]
  raw: Record<string, string>
  candidate: T | null
}

export interface ImportPlan<T extends { email: string }> {
  rows: RowPlan<T>[]
  counts: Record<"total" | "create" | "update" | "skipUnchanged" | "skipDuplicate" | "invalid", number>
  // One entry per email that appeared more than once, so the preview can show the
  // submissions that lost and let the operator pick a different one.
  duplicateGroups: DuplicateGroup[]
}

// Strip fields a human edited by hand, and report what was withheld so the
// operator can see it. The email is the identity, so it is never an update target:
// changing it via import would move the row onto a different person.
export function withheldManualEdits<T extends { email: string }>(
  record: T,
  manualEditedFields: string[],
): { changes: Partial<T>; protectedFields: string[] } {
  const locked = new Set(manualEditedFields)
  const changes: Partial<T> = {}
  const protectedFields: string[] = []

  for (const [key, value] of Object.entries(record) as [keyof T & string, T[keyof T & string]][]) {
    if (locked.has(key)) protectedFields.push(key)
    else changes[key] = value
  }

  delete changes.email

  return { changes, protectedFields }
}

// Decide which row wins for each email, and describe the losers.
//
// Order of authority: an explicit operator override, then the newest mapped
// timestamp, then the LAST row in the sheet. Last-wins is the right fallback for a
// form response sheet, where rows are appended in submission order, so a
// resubmission supersedes the original instead of being discarded.
function resolveDuplicates<T extends { email: string }>(
  prepared: PreparedRow<T>[],
  mapping: SheetMapping,
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

// Build the full plan for an import from rows the caller has already prepared.
// Pure: callers pass in what already exists, so this is exhaustively testable and
// the preview the operator approves is literally the plan that gets applied.
export function planPreparedImport<T extends { email: string }>(
  prepared: PreparedRow<T>[],
  mapping: SheetMapping,
  existing: ExistingRecord[],
  // Per-email row index the operator picked, overriding the automatic choice.
  overrides: Record<string, number> = {},
): ImportPlan<T> {
  const byEmail = new Map(existing.map((e) => [e.email.toLowerCase(), e]))
  const byRowKey = new Map(existing.filter((e) => e.sourceRowKey).map((e) => [e.sourceRowKey!, e]))

  // Duplicates are resolved against the whole sheet rather than in arrival order.
  // Keeping whichever row came FIRST would, on a Google Form response sheet, keep
  // the OLDEST submission: someone who resubmitted to correct their answers would
  // have the correction thrown away.
  const { winners, duplicateGroups } = resolveDuplicates(prepared, mapping, overrides)

  const rows: RowPlan<T>[] = []

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]
    const base = {
      index: p.index,
      rowKey: p.rowKey,
      rowHash: p.rowHash,
      raw: p.raw,
      candidate: p.candidate,
      ...(p.warnings?.length ? { warnings: p.warnings } : {}),
    }

    if (!p.candidate) {
      rows.push({ ...base, outcome: "invalid", errors: p.errors })
      continue
    }

    const identity = p.candidate.email.toLowerCase()
    if (winners.get(identity) !== i) {
      const group = duplicateGroups.find((g) => g.email === identity)
      const winnerRow = group ? prepared[group.winnerIndex] : undefined
      rows.push({
        ...base,
        outcome: "skip-duplicate",
        errors: [
          group?.byTimestamp
            ? `Superseded by a later submission from ${p.candidate.email} (row ${(winnerRow?.index ?? 0) + 1}).`
            : `Duplicate of another row in this sheet (${p.candidate.email}).`,
        ],
      })
      continue
    }

    const match = byRowKey.get(p.rowKey) ?? byEmail.get(identity)

    if (!match) {
      rows.push({ ...base, outcome: "create", changes: p.candidate })
      continue
    }

    // Unchanged content and same source row: nothing to do. Re-importing a sheet
    // nobody edited must be a genuine no-op.
    if (match.sourceRowHash === p.rowHash) {
      rows.push({ ...base, outcome: "skip-unchanged", candidateId: match.id })
      continue
    }

    const { changes, protectedFields } = withheldManualEdits(p.candidate, match.manualEditedFields)
    rows.push({ ...base, outcome: "update", candidateId: match.id, changes, protectedFields })
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

// Human-readable summary for the preview panel and the audit meta.
export function summarisePlan(plan: { counts: ImportPlan<{ email: string }>["counts"] }): string {
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
