import { normalizeEmail } from "@/lib/intake"

// Google Forms can give us both a respondent address captured by Google and an
// address the candidate typed into a question. Keep both: the captured address
// is the safety net when the typed one contains a plausible-looking typo.
export function recruitmentRecipientEmails(
  primaryEmail: string,
  formAnswers: unknown,
): string[] {
  const candidates = [primaryEmail]

  if (formAnswers && typeof formAnswers === "object" && !Array.isArray(formAnswers)) {
    for (const [rawHeader, rawValue] of Object.entries(formAnswers)) {
      const header = rawHeader.trim().toLowerCase().replace(/\s+/g, " ")
      if (header !== "email" && header !== "email address") continue
      if (typeof rawValue === "string") candidates.push(rawValue)
    }
  }

  const valid = new Map<string, string>()
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue
    if (!valid.has(email.toLowerCase())) valid.set(email.toLowerCase(), email)
  }
  return [...valid.values()]
}
