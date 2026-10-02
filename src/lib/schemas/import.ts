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
  const message = m[2] === "Required" ? "missing" : m[2] === "did not resolve" ? "no committee by that name" : m[2]
  return `${label}: ${message}`
}

export type ColumnMapping = Partial<Record<ImportFieldKey, string>>

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
