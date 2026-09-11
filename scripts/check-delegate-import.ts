#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-delegate-import.ts
//
// Delegate registration for the Intra MUN arrives through a Google Form response
// sheet, pulled in by the same engine recruitment uses. These are the properties
// an organiser relies on without knowing they exist: a student who resubmits is
// one person, a refetch never undoes hand edits, a bad row is shown rather than
// lost, and nobody from outside DTU slips through unnoticed.
//
// Headers below are the real question titles of the Intra MUN registration form,
// so this also pins that INTRA_FORM_MAPPING matches the form as it exists.
import assert from "node:assert"
import {
  delegateImportIdempotencyKey,
  looksLikeDtuRollNumber,
  munExperienceFrom,
  normalizeRollNumber,
  planDelegateImport,
  type ExistingDelegate,
} from "../src/lib/delegate-import"
import { INTRA_FORM_MAPPING, suggestDelegateMapping } from "../src/lib/schemas/delegate-import"

const SHEET = "sheet123:0"
const committees = [
  { id: "c-unsc", name: "UNSC", slug: "unsc", aliases: [] },
  { id: "c-aippm", name: "AIPPM", slug: "aippm", aliases: ["All India Political Parties Meet"] },
]

// A response-sheet row, keyed by the form's real headers.
function response(o: {
  ts?: string
  name?: string
  email?: string
  phone?: string
  roll?: string
  before?: string
  exp?: string
  c1?: string
  c2?: string
  p1?: string
  p2?: string
  query?: string
}): Record<string, string> {
  return {
    Timestamp: o.ts ?? "9/12/2026 10:00:00",
    "Full Name": o.name ?? "Test Person",
    "Email Address": o.email ?? "test@example.com",
    "Phone Number (active on WhatsApp)": o.phone ?? "9876543210",
    "Roll Number (in DTU Official Format)": o.roll ?? "2K23/CO/123",
    "Have you ever done an MUN in the past?": o.before ?? "No",
    "Past MUN Experience (N.A. in case of None)": o.exp ?? "N.A.",
    "First Preferred Committee": o.c1 ?? "UNSC",
    "Second Preferred Committee": o.c2 ?? "AIPPM",
    "First Preferred Portfolio": o.p1 ?? "India",
    "Second Preferred Portfolio": o.p2 ?? "Amit Shah",
    "Have you joined the WhatsApp group?\nhttps://chat.whatsapp.com/example": "DONE",
    "Any Queries?": o.query ?? "",
  }
}

const plan = (rows: Record<string, string>[], existing: ExistingDelegate[] = [], overrides = {}) =>
  planDelegateImport(rows, INTRA_FORM_MAPPING, { sheetKey: SHEET, existing, committees, overrides })

// ── The form's headers map without a human touching anything ────────────────
{
  const p = plan([response({})])
  assert.equal(p.counts.create, 1, "a clean form row must plan a create")
  const d = p.rows[0].candidate!
  assert.equal(d.fullName, "Test Person")
  assert.equal(d.whatsapp, "919876543210", "phone must be normalised")
  assert.equal(d.rollNumber, "2K23/CO/123")
  assert.equal(d.pref1CommitteeId, "c-unsc", "UNSC must resolve to the committee")
  assert.equal(d.pref2CommitteeId, "c-aippm")
  assert.equal(d.pref1Portfolio, "India")
  assert.equal(d.pref2Portfolio, "Amit Shah")
  assert.equal(p.rows[0].warnings, undefined, "a clean row must carry no warnings")

  const suggested = suggestDelegateMapping(Object.keys(response({})))
  assert.deepEqual(
    suggested,
    INTRA_FORM_MAPPING,
    "pasting the real response sheet must propose exactly the Intra form mapping",
  )
}

// ── A student who submits twice is one delegate, and the NEWER answer wins ──
{
  const p = plan([
    response({ email: "a@x.com", ts: "9/12/2026 10:00:00", p1: "France" }),
    response({ email: "a@x.com", ts: "9/13/2026 09:00:00", p1: "Germany" }),
  ])
  assert.equal(p.counts.create, 1, "two submissions from one email must create one delegate")
  assert.equal(p.counts.skipDuplicate, 1)
  const kept = p.rows.find((r) => r.outcome === "create")!
  assert.equal(kept.candidate!.pref1Portfolio, "Germany", "the LATER submission must win")
  assert.equal(p.duplicateGroups.length, 1, "the losing submission must stay visible to an organiser")
}

// ── Capitalisation does not make two people ────────────────────────────────
{
  const p = plan([response({ email: "Mixed.Case@Gmail.com" }), response({ email: "mixed.case@gmail.com", ts: "9/13/2026" })])
  assert.equal(p.counts.create, 1, "Mixed.Case@Gmail.com and mixed.case@gmail.com must be one person")
  assert.equal(p.rows.find((r) => r.outcome === "create")!.candidate!.email, "mixed.case@gmail.com")
}

// ── Refetching an unchanged sheet changes nothing ──────────────────────────
{
  const first = plan([response({ email: "b@x.com" })])
  const row = first.rows[0]
  const existing: ExistingDelegate[] = [
    { id: "d1", email: "b@x.com", sourceSheetKey: SHEET, sourceRowKey: row.rowKey, sourceRowHash: row.rowHash, manualEditedFields: [], status: "REGISTERED" },
  ]
  const again = plan([response({ email: "b@x.com" })], existing)
  assert.equal(again.counts.skipUnchanged, 1, "re-importing an unchanged row must be a no-op")
  assert.equal(again.counts.create + again.counts.update, 0)
}

// ── An organiser's hand edit survives a refetch ────────────────────────────
{
  const existing: ExistingDelegate[] = [
    { id: "d2", email: "c@x.com", sourceSheetKey: SHEET, sourceRowKey: "email:c@x.com", sourceRowHash: "old", manualEditedFields: ["whatsapp", "rollNumber"], status: "REGISTERED" },
  ]
  const p = plan([response({ email: "c@x.com", phone: "9000000001", roll: "2K24/EE/7", p1: "Japan" })], existing)
  const r = p.rows[0]
  assert.equal(r.outcome, "update")
  assert.ok(!("whatsapp" in (r.changes ?? {})), "a hand-edited phone must not be overwritten")
  assert.ok(!("rollNumber" in (r.changes ?? {})), "a hand-edited roll number must not be overwritten")
  assert.equal(r.changes!.pref1Portfolio, "Japan", "fields nobody edited must still update")
  assert.deepEqual(r.protectedFields, ["whatsapp", "rollNumber"])
  assert.ok(!("email" in (r.changes ?? {})), "email is the identity and must never be an update target")
}

// ── A broken row is shown, never dropped ───────────────────────────────────
{
  const p = plan([response({ email: "" }), response({ email: "not-an-email" }), response({ phone: "", email: "d@x.com" })])
  assert.equal(p.counts.invalid, 3, "rows missing email, with a bad email, or missing phone must all be invalid")
  assert.equal(p.counts.total, 3, "invalid rows must stay in the plan, not vanish")
  assert.ok(p.rows.every((r) => (r.errors?.length ?? 0) > 0), "every invalid row must say why")
}

// ── Someone outside DTU is flagged, not silently let through ───────────────
{
  const p = plan([response({ email: "e@x.com", roll: "hello" }), response({ email: "f@x.com", roll: "" })])
  assert.equal(p.counts.create, 2, "a doubtful roll number is a WARNING, not a rejection")
  assert.match((p.rows[0].warnings ?? []).join(" "), /doesn't look like a DTU roll number/)
  assert.match((p.rows[1].warnings ?? []).join(" "), /No roll number/)
}

// ── An email already registered another way is not merged or lost ─────────
{
  const existing: ExistingDelegate[] = [
    { id: "old", email: "g@x.com", sourceSheetKey: null, sourceRowKey: null, sourceRowHash: null, manualEditedFields: [], status: "CONFIRMED" },
  ]
  const p = plan([response({ email: "g@x.com" })], existing)
  assert.equal(p.rows[0].outcome, "invalid", "a clash with a delegate from elsewhere must not become an update of them")
  assert.match(p.rows[0].errors!.join(" "), /already registered another way \(status: confirmed\)/)
  assert.equal(p.counts.invalid, 1, "counts must reflect the reclassified row")
  assert.equal(p.counts.create, 0)
}

// ── An unknown committee is surfaced; an alias resolves ────────────────────
{
  const p = plan([
    response({ email: "h@x.com", c1: "UNSCC" }),
    response({ email: "i@x.com", c1: "All India Political Parties Meet" }),
  ])
  assert.equal(p.rows[0].candidate!.pref1CommitteeId, null)
  assert.match((p.rows[0].warnings ?? []).join(" "), /doesn't match any committee/)
  assert.equal(p.rows[1].candidate!.pref1CommitteeId, "c-aippm", "a committee alias must resolve")
}

// ── Field rules ────────────────────────────────────────────────────────────
{
  assert.equal(munExperienceFrom("No", "N.A."), null, "N.A. is not experience")
  assert.equal(munExperienceFrom("No", "none"), null)
  assert.equal(munExperienceFrom("Yes", "N.A"), "Yes", "a Yes with no description still says something")
  assert.equal(munExperienceFrom("Yes", "DTU MUN 2025, Best Delegate"), "DTU MUN 2025, Best Delegate")

  assert.equal(normalizeRollNumber(" 2k23 / co / 123 "), "2K23/CO/123")
  assert.equal(normalizeRollNumber("23-CO-45"), "23/CO/45")
  for (const ok of ["2K23/CO/123", "23/CO/45", "2K22/A1/9"]) assert.ok(looksLikeDtuRollNumber(ok), ok)
  for (const bad of ["hello", "12345", "CO/123", ""]) assert.ok(!looksLikeDtuRollNumber(bad || null), bad)

  const p = plan([response({ email: "j@x.com", phone: "call me" })])
  assert.equal(p.rows[0].outcome, "create", "a malformed phone must not lose the registration")
  assert.equal(p.rows[0].candidate!.whatsapp, "call me", "it is kept as typed")
  assert.match((p.rows[0].warnings ?? []).join(" "), /doesn't look like a 10-digit number/)
}

// ── Applying the same sheet twice is a no-op ───────────────────────────────
{
  const rows = [response({ email: "k@x.com" })]
  const a = delegateImportIdempotencyKey({ sourceId: "s1", mapping: INTRA_FORM_MAPPING, rows })
  const b = delegateImportIdempotencyKey({ sourceId: "s1", mapping: INTRA_FORM_MAPPING, rows })
  const c = delegateImportIdempotencyKey({ sourceId: "s1", mapping: INTRA_FORM_MAPPING, rows: [response({ email: "k@x.com", p1: "Chad" })] })
  assert.equal(a, b, "the same content must produce the same key")
  assert.notEqual(a, c, "changed content must produce a different key")
}

console.log("delegate import checks passed (form mapping, resubmission, case, refetch, hand edits, invalid rows, DTU, clashes, committees)")
