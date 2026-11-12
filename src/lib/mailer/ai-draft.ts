// A mail drafted by the model from the organiser's notes.
//
// It only ever fills the composer's fields. The mailer lays a mail out as
// paragraphs and one button inside the shared shell, so that is all the model is
// asked for: no HTML of its own reaches an inbox. A person reads, edits and sends
// the result exactly as they would a mail typed by hand.

import { z } from "zod"
import { MERGE_FIELDS, ctaUrlOk } from "./merge"
import type { PresetDraft } from "./presets"

export const DRAFT_NOTES_MIN = 10
export const DRAFT_NOTES_MAX = 4000

export type DraftAudience = "DELEGATES" | "CONTACTS"

// Outreach contacts have no seat, delegate page or delegates' group to merge in.
export function draftFields(audience: DraftAudience) {
  return MERGE_FIELDS.filter((f) => audience === "DELEGATES" || !/delegates/i.test(f.hint))
}

export function draftPrompt({ notes, audience, eventName }: { notes: string; audience: DraftAudience; eventName: string }): string {
  const fields = draftFields(audience)
  const linkFields = fields.filter((f) => ctaUrlOk(`{${f.key}}`)).map((f) => `{${f.key}}`)
  return `You write emails for the secretariat of ${eventName}, a student-run Model United Nations event. Write one email from the organiser's notes at the end.

It goes to ${audience === "DELEGATES" ? "delegates registered for the event" : "people on the outreach list who asked to hear about the society's events"}.

Rules:
- Use only what the notes say. Never invent a date, time, venue, link, amount, deadline or name. If a detail is missing, leave it out instead of guessing.
- Copy every link in the notes exactly, character for character.
- Plain text only: no markdown, no HTML, no emoji, no long dashes. Separate paragraphs with one blank line. A schedule, or three or more parallel items, goes in a list: consecutive lines that each start with "- ".
- Start the body with "Hi {firstName}," and end it with "The ${eventName} Secretariat" on its own line.
- Lead with what the reader needs to know or do. Short paragraphs, warm and direct, no filler.
- These placeholders are filled in for each recipient. Write them exactly as shown instead of a value, and use no others: ${fields.map((f) => `{${f.key}} (${f.hint})`).join(", ")}.
- subject: under 80 characters and specific to this mail.
- Button: if the notes have one main link the reader should open, put a label of at most four words in ctaLabel and the link in ctaUrl, and do not repeat that link in the body. ctaUrl must be an https:// link from the notes${linkFields.length ? `, or exactly ${linkFields.join(" or ")}` : ""}. Otherwise leave both as empty strings.

Respond only with JSON: {"subject":"...","body":"...","ctaLabel":"...","ctaUrl":"..."}

Organiser's notes:
"""
${notes}
"""`
}

const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  ctaLabel: z.string().nullish(),
  ctaUrl: z.string().nullish(),
})

// The mailer prints the text as written, so markup the model slips in would
// reach the reader as literal asterisks.
const plain = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s+/gm, "")
    .replace(/^\* /gm, "- ")
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/\s*\u2014\s*/g, ", ")
    .trim()

// Null when the reply cannot be used. A button that would fail the composer's
// own check is dropped, never passed on half-made.
export function parseDraft(raw: unknown): PresetDraft | null {
  const parsed = draftSchema.safeParse(raw)
  if (!parsed.success) return null
  const subject = plain(parsed.data.subject).replace(/\s+/g, " ").slice(0, 200)
  const body = plain(parsed.data.body).slice(0, 20000)
  if (!subject || !body) return null
  const ctaLabel = plain(parsed.data.ctaLabel ?? "").slice(0, 60)
  const ctaUrl = (parsed.data.ctaUrl ?? "").trim()
  return ctaLabel && ctaUrlOk(ctaUrl) ? { subject, body, ctaLabel, ctaUrl } : { subject, body }
}
