// Delegate registration via a Google Form response sheet: which fields exist and
// how a sheet column maps onto them. Client-safe (no node:crypto), because the
// mapping screen renders this list in the browser.
import { z } from "zod"

export const DELEGATE_IMPORT_FIELDS = [
  { key: "fullName", label: "Full name", required: true },
  { key: "email", label: "Email address", required: true },
  { key: "whatsapp", label: "Phone / WhatsApp", required: true },
  { key: "rollNumber", label: "DTU roll number", required: false },
  { key: "munBefore", label: "Done an MUN before? (Yes/No)", required: false },
  { key: "munExperience", label: "Past MUN experience", required: false },
  { key: "pref1Committee", label: "First committee choice", required: false },
  { key: "pref1Portfolio", label: "First portfolio choice", required: false },
  { key: "pref2Committee", label: "Second committee choice", required: false },
  { key: "pref2Portfolio", label: "Second portfolio choice", required: false },
  { key: "query", label: "Any queries?", required: false },
  // Map it whenever the sheet has one: it is what lets a resubmission supersede
  // the original, instead of the oldest row winning by arrival order.
  { key: "timestamp", label: "Submitted at (Timestamp)", required: false },
] as const

export type DelegateFieldKey = (typeof DELEGATE_IMPORT_FIELDS)[number]["key"]

// { delegateField: sheetColumnHeader }. Name, email and phone are mandatory
// because a Delegate row cannot exist without them.
export const delegateMappingSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().min(1),
  whatsapp: z.string().min(1),
  rollNumber: z.string().min(1).optional(),
  munBefore: z.string().min(1).optional(),
  munExperience: z.string().min(1).optional(),
  pref1Committee: z.string().min(1).optional(),
  pref1Portfolio: z.string().min(1).optional(),
  pref2Committee: z.string().min(1).optional(),
  pref2Portfolio: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  timestamp: z.string().min(1).optional(),
})

export type DelegateMapping = z.infer<typeof delegateMappingSchema>

// The Intra MUN registration form's question titles, which become the response
// sheet's column headers verbatim. Pre-filling these means a volunteer pasting
// the sheet link only has to CONFIRM the mapping, not build it. Matching is
// case- and whitespace-insensitive (see mappedValue), so small edits to a
// question's wording still resolve; a renamed question does not, and shows up as
// an unmapped column in the mapping screen.
export const INTRA_FORM_MAPPING: DelegateMapping = {
  timestamp: "Timestamp",
  fullName: "Full Name",
  email: "Email Address",
  whatsapp: "Phone Number (active on WhatsApp)",
  rollNumber: "Roll Number (in DTU Official Format)",
  munBefore: "Have you ever done an MUN in the past?",
  munExperience: "Past MUN Experience (N.A. in case of None)",
  pref1Committee: "First Preferred Committee",
  pref2Committee: "Second Preferred Committee",
  pref1Portfolio: "First Preferred Portfolio",
  pref2Portfolio: "Second Preferred Portfolio",
  query: "Any Queries?",
}

// For an unfamiliar sheet: propose a mapping by matching each field's label and
// the Intra form's own question against the sheet's headers. Only exact
// (normalised) matches are proposed -- a wrong guess on the email column would
// be far worse than an empty one the volunteer fills in.
export function suggestDelegateMapping(headers: string[]): Partial<DelegateMapping> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const byNorm = new Map(headers.map((h) => [norm(h), h]))
  const out: Partial<DelegateMapping> = {}
  for (const field of DELEGATE_IMPORT_FIELDS) {
    const candidates = [INTRA_FORM_MAPPING[field.key], field.label].filter(Boolean) as string[]
    for (const c of candidates) {
      const hit = byNorm.get(norm(c))
      if (hit) {
        out[field.key] = hit
        break
      }
    }
  }
  return out
}
