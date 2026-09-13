// Fill {placeholders} in a mail's subject and body for one recipient.
//
// Only known fields are replaced. An unknown or misspelt one, say {nmae}, is left
// exactly as typed rather than silently blanked, so it shows up in the preview
// and the test send instead of reaching several hundred inboxes as a gap.

export type MergeVars = Partial<Record<MergeField, string>>

export const MERGE_FIELDS = [
  { key: "name", hint: "Full name" },
  { key: "firstName", hint: "First name only" },
  { key: "event", hint: "Event name" },
  { key: "dates", hint: "Conference dates" },
  { key: "venue", hint: "Venue" },
  { key: "committee", hint: "Allotted committee, delegates only" },
  { key: "portfolio", hint: "Allotted portfolio, delegates only" },
  { key: "statusLink", hint: "Their delegate page, delegates only" },
  { key: "registerLink", hint: "Registration page" },
  { key: "whatsapp", hint: "Delegates' WhatsApp group" },
] as const

export type MergeField = (typeof MERGE_FIELDS)[number]["key"]

const KNOWN = new Set<string>(MERGE_FIELDS.map((f) => f.key))

export function renderMerge(text: string, vars: MergeVars): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (whole, key: string) => {
    if (!KNOWN.has(key)) return whole
    const value = vars[key as MergeField]
    return value === undefined ? whole : value
  })
}

// Placeholders the text uses that this recipient has no value for. Shown in the
// composer, so "{committee}" in a mail to unallotted delegates is caught before
// sending, not after.
export function unfilledFields(text: string, vars: MergeVars): string[] {
  const missing = new Set<string>()
  for (const [, key] of text.matchAll(/\{([a-zA-Z]+)\}/g)) {
    if (!KNOWN.has(key) || !vars[key as MergeField]) missing.add(key)
  }
  return [...missing]
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ""
}

// Blank lines separate paragraphs; single newlines stay inside one.
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}
