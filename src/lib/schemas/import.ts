import { z } from "zod"

export const IMPORT_FIELDS = [
  { key: "fullName",    label: "Full name",              required: true  },
  { key: "email",       label: "Email address",          required: true  },
  { key: "whatsapp",    label: "Phone / WhatsApp",       required: false },
  { key: "institution", label: "Institution",            required: false },
  { key: "committee",   label: "Committee pref 1",       required: false },
  { key: "portfolio",   label: "Portfolio / Country 1",  required: false },
  { key: "committee2",  label: "Committee pref 2",       required: false },
  { key: "portfolio2",  label: "Portfolio / Country 2",  required: false },
  { key: "committee3",  label: "Committee pref 3",       required: false },
  { key: "portfolio3",  label: "Portfolio / Country 3",  required: false },
  { key: "note",        label: "Note / remark",          required: false },
] as const

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"]

// Row errors are stored as "field: message" (zod's path and message). Shown to
// staff as the column's own label, so "fullName: Required" reads "Full name: missing".
export function readableRowError(error: string): string {
  const m = /^(\w+): (.*)$/.exec(error)
  if (!m) return error
  const label = IMPORT_FIELDS.find((f) => f.key === m[1])?.label ?? m[1]
  const unresolved = /^did not resolve(?: \((.*)\))?$/.exec(m[2])
  const message =
    m[2] === "Required"
      ? "missing"
      : unresolved
        ? `${unresolved[1] ? `"${unresolved[1]}"` : "the answer"} is not one of our committees; choose which one they meant`
        : m[2]
  return `${label}: ${message}`
}

export type ColumnMapping = Partial<Record<ImportFieldKey, string>>

// How committee answers are compared everywhere: case, spaces and punctuation
// do not make a different committee. Client-safe, so the review can tell which
// answers still need a person.
export function committeeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export type CommitteeField = "committee" | "committee2" | "committee3"
export const COMMITTEE_FIELDS: CommitteeField[] = ["committee", "committee2", "committee3"]

// Committee answers in a row that name none of these committees exactly.
export function unresolvedCommittees(row: MappedRow, committeeNames: string[]): CommitteeField[] {
  const known = new Set(committeeNames.map(committeeKey))
  return COMMITTEE_FIELDS.filter((f) => row[f]?.trim() && !known.has(committeeKey(row[f]!)))
}

export const mappedRowSchema = z.object({
  fullName:    z.string().min(2, "Name must be at least 2 characters"),
  email:       z.string().email("Invalid email address"),
  whatsapp:    z.string().optional(),
  institution: z.string().optional(),
  committee:   z.string().optional(),
  portfolio:   z.string().optional(),
  committee2:  z.string().optional(),
  portfolio2:  z.string().optional(),
  committee3:  z.string().optional(),
  portfolio3:  z.string().optional(),
  note:        z.string().optional(),
})

export type MappedRow = z.infer<typeof mappedRowSchema>

export interface ValidatedRow {
  index:  number
  raw:    Record<string, string>
  mapped: MappedRow
  errors: string[]
  aiNote?: string
  // The AI's reading of committee answers nothing matched, for a person to accept.
  suggest?: Partial<Record<CommitteeField, string>>
  // Flagged as a non-data row (a title, a totals line).
  skip?: boolean
}

export function applyMapping(
  raw: Record<string, string>,
  mapping: ColumnMapping,
  defaultInstitution?: string,
): MappedRow {
  const get = (key: ImportFieldKey): string =>
    (mapping[key] ? (raw[mapping[key]!] ?? "") : "").trim()

  const institution = get("institution") || defaultInstitution || undefined

  return {
    fullName:    get("fullName"),
    email:       get("email").toLowerCase(),
    whatsapp:    get("whatsapp") || undefined,
    institution,
    committee:   get("committee") || undefined,
    portfolio:   get("portfolio") || undefined,
    committee2:  get("committee2") || undefined,
    portfolio2:  get("portfolio2") || undefined,
    committee3:  get("committee3") || undefined,
    portfolio3:  get("portfolio3") || undefined,
    note:        get("note") || undefined,
  }
}

export function validateRow(
  index: number,
  raw: Record<string, string>,
  mapping: ColumnMapping,
  defaultInstitution?: string,
): ValidatedRow {
  const mapped = applyMapping(raw, mapping, defaultInstitution)
  const result = mappedRowSchema.safeParse(mapped)
  const errors = result.success ? [] : result.error.issues.map((i) => i.message)
  return { index, raw, mapped, errors }
}

// The review's rows from the cleaning pass. One place, so the automatic and the
// manual mapping paths both keep the flags (a non-data row stays skipped; an AI
// committee reading stays a suggestion).
export function validatedFromCleaned(
  cleaned: (MappedRow & { _note?: string; _skip?: boolean; _suggest?: Partial<Record<CommitteeField, string>> })[],
  rawRows: Record<string, string>[],
): ValidatedRow[] {
  return cleaned.map(({ _note, _skip, _suggest, ...mapped }, i) => {
    const parse = mappedRowSchema.safeParse(mapped)
    return {
      index: i,
      raw: rawRows[i],
      mapped,
      errors: parse.success ? [] : parse.error.issues.map((e) => e.message),
      aiNote: _note,
      ...(_suggest ? { suggest: _suggest } : {}),
      ...(_skip ? { skip: true } : {}),
    }
  })
}
