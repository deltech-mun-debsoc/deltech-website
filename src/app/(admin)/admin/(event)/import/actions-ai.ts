"use server"

import { z } from "zod"
import { callAI, AIRateLimitError } from "@/lib/ai"
import { requireStaff } from "@/lib/authz"
import { getCommitteeRefs, normalizeRow } from "@/lib/intake"
import type { ColumnMapping, MappedRow } from "@/lib/schemas/import"

// ---------------------------------------------------------------------------
// Suggest column mapping
// ---------------------------------------------------------------------------

export async function suggestMappingWithGemini(
  headers: string[],
  sampleRows: Record<string, string>[],
): Promise<{ success: boolean; mapping?: ColumnMapping; error?: string; rateLimited?: boolean }> {
  await requireStaff()

  const prompt = `You are helping import delegate data for a Model United Nations (MUN) conference.

Column headers from the uploaded spreadsheet:
${JSON.stringify(headers)}

First few rows of sample data:
${JSON.stringify(sampleRows.slice(0, 5), null, 2)}

Map each of our system fields to the best-matching column header from the list above.
The value must be the EXACT header string as it appears in the list, or null if no confident match.

Field definitions and common column name patterns:
- fullName: Delegate's complete name. Common: "Full name", "Name", "Participant name", "Delegate name"
- email: Email address. Common: "Email ID", "Email", "E-mail", "Mail ID"
- whatsapp: Phone or WhatsApp number. Common: "Phone number", "Phone", "WhatsApp", "Mobile", "Contact number"
- institution: College, university, or school. Common: "College", "Institution", "University", "School"
- committee: FIRST committee preference. Common: "Committee preference 1", "Committee 1", "1st preference", "Pref 1 committee"
- portfolio: FIRST portfolio/country. Common: "Portfolio 1", "Country 1", "Character 1", paired with the first committee preference
- committee2: SECOND committee preference. Common: "Committee preference 2", "Committee 2", "2nd preference", "Pref 2 committee"
- portfolio2: SECOND portfolio/country. Common: "Portfolio 2", "Country 2", "Character 2", paired with the second committee preference
- committee3: THIRD committee preference. Common: "Committee preference 3", "Committee 3", "3rd preference", "Pref 3 committee"
- portfolio3: THIRD portfolio/country. Common: "Portfolio 3", "Country 3", "Character 3", paired with the third committee preference
- note: Remarks or special instructions. Common: "Note", "Remarks", "Comments", "Special notes"

Respond with a JSON object using exactly these keys (string value = the exact matching header, null = no match):
{
  "fullName": null,
  "email": null,
  "whatsapp": null,
  "institution": null,
  "committee": null,
  "portfolio": null,
  "committee2": null,
  "portfolio2": null,
  "committee3": null,
  "portfolio3": null,
  "note": null
}`

  try {
    const raw = await callAI<Partial<Record<keyof ColumnMapping, string | null>>>(prompt)
    const mapping: ColumnMapping = {}
    for (const [field, col] of Object.entries(raw)) {
      if (col && headers.includes(col)) {
        mapping[field as keyof ColumnMapping] = col
      }
    }
    return { success: true, mapping }
  } catch (err) {
    if (err instanceof AIRateLimitError)
      return { success: false, error: err.message, rateLimited: true }
    return { success: false, error: err instanceof Error ? err.message : "AI mapping failed." }
  }
}

// ---------------------------------------------------------------------------
// Clean & normalise rows, deterministic pipeline first, AI only for leftovers
// ---------------------------------------------------------------------------

export type CleanedRow = MappedRow & { _note?: string; _skip?: boolean }

// Junk rows the deterministic pass can already catch (header repeats etc.)
const JUNK_NAME = /^(name|full ?name|delegate ?name|participant|sr\.? ?no\.?|s\.? ?no\.?|#|total|count)$/i

const aiRowSchema = z.object({
  fullName: z.string().nullish(),
  email: z.string().nullish(),
  whatsapp: z.string().nullish(),
  institution: z.string().nullish(),
  committee: z.string().nullish(),
  portfolio: z.string().nullish(),
  committee2: z.string().nullish(),
  portfolio2: z.string().nullish(),
  committee3: z.string().nullish(),
  portfolio3: z.string().nullish(),
  note: z.string().nullish(),
  _note: z.string().nullish(),
  _skip: z.boolean().nullish(),
})
const aiResponseSchema = z.object({ rows: z.array(aiRowSchema) })

export async function cleanImportRowsWithGemini(
  rows: MappedRow[],
  _committeeNames: string[],
): Promise<{ success: boolean; cleaned?: CleanedRow[]; error?: string; rateLimited?: boolean }> {
  await requireStaff()
  if (rows.length === 0) return { success: true, cleaned: [] }

  const committees = await getCommitteeRefs()

  // Pass 1, deterministic. Free, instant, and correct for the common case.
  const cleaned: CleanedRow[] = []
  const needsAI: number[] = []

  rows.forEach((input, i) => {
    const { row, unresolved } = normalizeRow(input, committees)
    const changed: string[] = []
    if (row.fullName !== input.fullName?.trim()) changed.push("name casing")
    if (row.email !== input.email?.trim()) changed.push("email")
    if (row.whatsapp !== input.whatsapp?.trim()) changed.push("phone")

    if (JUNK_NAME.test(input.fullName ?? "") || (!row.email && !row.fullName)) {
      cleaned[i] = { ...row, _note: "looks like a non-data row", _skip: true }
      return
    }

    cleaned[i] = { ...row, _note: changed.length ? changed.join(", ") : undefined, _skip: false }

    // AI is only worth its tokens where deterministic matching gave up:
    // unresolved committee names, or an email that still looks broken.
    if (unresolved.length > 0 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
      needsAI.push(i)
    }
  })

  if (needsAI.length === 0) return { success: true, cleaned }

  // Pass 2 · AI, batched, zod-validated. Failure falls back to pass 1 output.
  const BATCH = 40
  const committeeList = committees.map((c) => c.name).join(", ") || "(none defined yet)"

  for (let start = 0; start < needsAI.length; start += BATCH) {
    const batchIdx = needsAI.slice(start, start + BATCH)
    const batchRows = batchIdx.map((i) => cleaned[i])
    try {
      const result = await cleanBatchWithAI(batchRows, committeeList)
      result.forEach((r, j) => {
        const i = batchIdx[j]
        cleaned[i] = {
          fullName: r.fullName || cleaned[i].fullName,
          email: r.email || cleaned[i].email,
          whatsapp: r.whatsapp ?? cleaned[i].whatsapp,
          institution: r.institution ?? cleaned[i].institution,
          committee: r.committee ?? undefined,
          portfolio: r.portfolio ?? cleaned[i].portfolio,
          committee2: r.committee2 ?? undefined,
          portfolio2: r.portfolio2 ?? cleaned[i].portfolio2,
          committee3: r.committee3 ?? undefined,
          portfolio3: r.portfolio3 ?? cleaned[i].portfolio3,
          note: r.note ?? cleaned[i].note,
          _note: [cleaned[i]._note, r._note].filter(Boolean).join(", ") || undefined,
          _skip: r._skip === true || cleaned[i]._skip,
        }
      })
    } catch (err) {
      if (err instanceof AIRateLimitError) {
        return { success: false, error: err.message, rateLimited: true }
      }
      // AI unavailable or returned garbage, deterministic result stands.
      batchIdx.forEach((i) => {
        cleaned[i] = {
          ...cleaned[i],
          _note: [cleaned[i]._note, "AI cleanup unavailable, check committee names"]
            .filter(Boolean)
            .join(", "),
        }
      })
    }
  }

  return { success: true, cleaned }
}

async function cleanBatchWithAI(
  rows: CleanedRow[],
  committeeList: string,
): Promise<z.infer<typeof aiRowSchema>[]> {
  const prompt = `You are cleaning cross-delegation delegate data for a Model United Nations conference. These delegates are always from external institutions, never the host institution.

Valid committees in our system: ${committeeList}

IMPORTANT: Some rows may be non-data rows added to the spreadsheet for convenience (e.g. a title row, a blank separator, an instruction line, a totals row, or a row where the name field is a column label like "Name" or "Sr. No."). For those, set _skip: true and leave other fields as-is.

Normalise every field in each data row according to these rules:

fullName · Proper title case. Strip leading honorifics (Mr, Ms, Mrs, Dr, Prof, Er, Ar, Adv, CA, Er.) but keep them if embedded mid-name. Preserve hyphens and apostrophes. Indian names: keep all parts capitalised (e.g. "RITU SHARMA" → "Ritu Sharma", "md. arshad" → "Md. Arshad").

email · Lowercase, strip all whitespace. Fix common typos: gmial/gmal/gamil → gmail, yahooo/yaho → yahoo, redifmail/redimail → rediffmail, outloo/otlook → outlook, hotmal/homail → hotmail. Remove spaces around "@" or ".". Leave unchanged if clearly invalid or empty.

whatsapp · Digits only, with India country code (91). Return null if value is "N/A", "na", "same", "same as above", "nil", empty, clearly not a phone number, or fewer than 10 digits.

institution · Proper title case, trim. Return null if empty or "N/A".

committee / committee2 / committee3 · Each: match to the closest entry from the valid committees list (case-insensitive, fuzzy). The returned value MUST be an exact string from the valid committees list, or null if no confident match, do not guess or invent.

portfolio / portfolio2 / portfolio3 · Each: standard proper-case country or character name. Expand only if unambiguous: "USA" → "United States of America", "UK" → "United Kingdom", "UAE" → "United Arab Emirates". Return null if empty.

note · Trim whitespace only. Return null if empty.

_note · Short comma-separated list of changes you made. Return null if nothing changed and _skip is false.

_skip, true only if this row is clearly a non-data row. false for all real delegate rows.

Input rows (${rows.length} total):
${JSON.stringify(rows.map(({ _note: _n, _skip: _s, ...r }) => r))}

Respond with a JSON object containing a "rows" array of exactly ${rows.length} cleaned objects, same order as input. Each object must have these exact keys: fullName, email, whatsapp, institution, committee, portfolio, committee2, portfolio2, committee3, portfolio3, note, _note, _skip. Use null for missing/empty optional fields.`

  const data = await callAI<unknown>(prompt)
  const parsed = aiResponseSchema.safeParse(data)
  if (!parsed.success || parsed.data.rows.length !== rows.length) {
    throw new Error(
      `AI returned ${parsed.success ? parsed.data.rows.length : "unparseable"} rows, expected ${rows.length}.`,
    )
  }
  return parsed.data.rows
}
