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
  type Resolutions,
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

const plan = (rows: Record<string, string>[], existing: ExistingDelegate[] = [], resolutions: Partial<Resolutions> = {}) =>
  planDelegateImport(rows, INTRA_FORM_MAPPING, {
    sheetKey: SHEET,
    existing,
    committees,
    resolutions: { committees: {}, rows: {}, keep: {}, ...resolutions },
  })

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
  assert.equal(p.rows[0].bucket, "decision", "a clash with a delegate from elsewhere is a question, never an update of them")
  assert.equal(p.rows[0].decisions[0].kind, "identity")
  assert.equal(p.buckets.ready, 0)
}

// ── An unknown committee is surfaced; an alias resolves ────────────────────
{
  const p = plan([
    response({ email: "h@x.com", c1: "UNSCC" }),
    response({ email: "i@x.com", c1: "All India Political Parties Meet" }),
  ])
  assert.equal(p.rows[0].candidate!.pref1CommitteeId, null)
  assert.equal(p.rows[0].bucket, "decision", "an unknown committee holds the row for a decision, not a silent empty")
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
  const key = (o: Partial<Parameters<typeof delegateImportIdempotencyKey>[0]> = {}) =>
    delegateImportIdempotencyKey({ eventId: "e1", sourceId: "s1", mapping: INTRA_FORM_MAPPING, rows, ...o })
  const a = key()
  assert.equal(a, key(), "the same content must produce the same key")
  assert.notEqual(a, key({ rows: [response({ email: "k@x.com", p1: "Chad" })] }), "changed content must produce a different key")
  // The plan token binds approval to all of these: change any one and Import
  // refuses until it is checked again.
  assert.notEqual(a, key({ eventId: "e2" }), "the same tab in next year's event is a different plan")
  assert.notEqual(a, key({ sourceId: "s2" }), "another source is a different plan")
  assert.notEqual(a, key({ mapping: { ...INTRA_FORM_MAPPING, rollNumber: undefined } }), "a changed mapping is a different plan")
  assert.notEqual(a, key({ resolutions: { committees: {}, rows: {}, keep: { "k@x.com": "h" } } }), "a different submission kept is a different plan")
  assert.notEqual(a, key({ resolutions: { committees: { disec: "c-unsc" }, rows: {}, keep: {} } }), "a committee answer settled differently is a different plan")
  // Re-sorting the sheet changes the content order, which is also a new plan.
  const two = [response({ email: "a@x.com" }), response({ email: "b@x.com" })]
  assert.notEqual(key({ rows: two }), key({ rows: [...two].reverse() }), "a reordered sheet must be checked again")
}

// ── Keeping an earlier submission is pinned to its content ──────────────────
{
  const early = response({ ts: "9/12/2026 10:00:00", email: "r@x.com", p1: "France" })
  const late = response({ ts: "9/13/2026 10:00:00", email: "r@x.com", p1: "Chad" })
  const p = plan([early, late])
  assert.equal(p.rows[1].outcome, "create", "the latest submission is kept by default")
  const earlyHash = p.rows[0].rowHash
  const kept = plan([early, late], [], { keep: { "r@x.com": earlyHash } })
  assert.equal(kept.rows[0].outcome, "create", "the chosen submission is kept")
  assert.equal(kept.rows[1].outcome, "skip-duplicate")
  // The same choice survives the sheet being re-sorted: it follows the answer,
  // not the row number.
  const resorted = plan([late, early], [], { keep: { "r@x.com": earlyHash } })
  assert.equal(resorted.rows[1].outcome, "create", "the kept answer follows its content after a re-sort")
  assert.equal(resorted.rows[1].candidate?.pref1Portfolio, "France")
}

// ── Acceptance: the review asks, it does not guess ─────────────────────────
{
  const shared = [
    { id: "c-a", name: "UNGA-DISEC", slug: "unga-disec", aliases: ["DISEC"] },
    { id: "c-b", name: "DISEC Junior", slug: "disec-jr", aliases: ["DISEC"] },
    { id: "c-unsc", name: "UNSC", slug: "unsc", aliases: [] },
  ]
  const planWith = (rows: Record<string, string>[], res: Partial<Resolutions> = {}, existing: ExistingDelegate[] = []) =>
    planDelegateImport(rows, INTRA_FORM_MAPPING, {
      sheetKey: SHEET,
      existing,
      committees: shared,
      resolutions: { committees: {}, rows: {}, keep: {}, ...res },
    })

  // Two committees sharing an alias: one question for every row that gave it.
  const two = planWith([response({ email: "s1@x.com", c1: "DISEC", c2: "", phone: "9300000001", roll: "2K23/CO/1" }), response({ email: "s2@x.com", c1: "disec", c2: "", phone: "9300000002", roll: "2K23/CO/2" })])
  assert.equal(two.buckets.decision, 2)
  const q = two.rows[0].decisions[0]
  assert.ok(q.kind === "committee" && q.ambiguous && q.candidates.length === 2, "both committees are offered, neither is picked")
  assert.equal(q.kind === "committee" && q.key, two.rows[1].decisions[0].kind === "committee" && two.rows[1].decisions[0].key, "the same answer is one question")
  const answered = planWith([response({ email: "s1@x.com", c1: "DISEC", c2: "", phone: "9300000001", roll: "2K23/CO/1" }), response({ email: "s2@x.com", c1: "disec", c2: "", phone: "9300000002", roll: "2K23/CO/2" })], { committees: { disec: "c-b" } })
  assert.equal(answered.buckets.ready, 2, "one answer settles every row")
  assert.ok(answered.rows.every((r) => r.candidate!.pref1CommitteeId === "c-b"))

  // A near-match committee is suggested, never applied.
  const near = planWith([response({ email: "n@x.com", c1: "UNSCC", c2: "" })])
  const nq = near.rows[0].decisions[0]
  assert.equal(near.rows[0].bucket, "decision")
  assert.ok(nq.kind === "committee" && !nq.ambiguous && nq.candidates[0].id === "c-unsc")
  assert.equal(near.rows[0].candidate!.pref1CommitteeId, null)
  // "Leave it empty" is an answer too.
  assert.equal(planWith([response({ email: "n@x.com", c1: "UNSCC", c2: "" })], { committees: { unscc: null } }).rows[0].bucket, "ready")

  // Someone already registered on the website: three answers, none of them
  // touches their stage or seat.
  const site: ExistingDelegate[] = [
    { id: "w1", email: "w@x.com", fullName: "Web Person", source: "SELF", seat: "UNSC · India", sourceSheetKey: null, sourceRowKey: null, sourceRowHash: null, manualEditedFields: ["rollNumber"], status: "CONFIRMED" },
  ]
  const row = [response({ email: "w@x.com", phone: "9111111111", roll: "2K24/ME/9", c1: "UNSC", c2: "", p1: "France" })]
  const ask = planWith(row, {}, site)
  const id = ask.rows[0].decisions[0]
  assert.ok(id.kind === "identity" && id.existing.seat === "UNSC · India" && id.existing.source === "SELF", "the existing record's source and seat are shown")
  const h = ask.rows[0].rowHash
  const skip = planWith(row, { rows: { [h]: "skip" } }, site)
  assert.equal(skip.rows[0].outcome, "skip-kept")
  assert.equal(skip.rows[0].bucket, "skipped")
  const safe = planWith(row, { rows: { [h]: "safe-fields" } }, site)
  assert.equal(safe.rows[0].outcome, "update")
  assert.equal(safe.rows[0].candidateId, "w1")
  assert.ok(safe.rows[0].safeOnly)
  assert.deepEqual(Object.keys(safe.rows[0].changes!).sort(), ["whatsapp"], "only contact details, and never a field edited by hand")
  assert.deepEqual(safe.rows[0].protectedFields, ["rollNumber"])
  const fixed = planWith(row, { rows: { [h]: { email: "w.other@x.com" } } }, site)
  assert.equal(fixed.rows[0].outcome, "create")
  assert.equal(fixed.rows[0].candidate!.email, "w.other@x.com")
  assert.equal(fixed.rows[0].rowHash, h, "the correction stays attached to the same response")
  // Once the contact correction is applied, the response is done.
  const applied = planWith(row, {}, [{ ...site[0], sourceRowHash: h }])
  assert.equal(applied.rows[0].outcome, "skip-unchanged", "a response already applied is not asked about again")

  // The same student under two emails: flagged, never merged.
  const twin = [response({ email: "t1@x.com", roll: "2K23/CO/777", c1: "UNSC", c2: "" }), response({ email: "t2@x.com", roll: "2K23/CO/777", phone: "9222222222", c1: "UNSC", c2: "" })]
  const dup = planWith(twin)
  assert.equal(dup.buckets.decision, 2, "both responses are flagged")
  const dq = dup.rows[1].decisions[0]
  assert.ok(dq.kind === "possible-duplicate" && dq.by === "roll number" && dq.others[0].email === "t1@x.com")
  const settled = planWith(twin, { rows: { [dup.rows[0].rowHash]: "import", [dup.rows[1].rowHash]: "skip" } })
  assert.equal(settled.rows[0].bucket, "ready")
  assert.equal(settled.rows[1].outcome, "skip-kept")
  // Against someone already registered with another email, too.
  const reg = planWith([response({ email: "t3@x.com", roll: "2K23/CO/888", c1: "UNSC", c2: "" })], {}, [
    { id: "r1", email: "old@x.com", rollNumber: "2K23/CO/888", sourceSheetKey: null, sourceRowKey: null, sourceRowHash: null, manualEditedFields: [], status: "REGISTERED" },
  ])
  const rq = reg.rows[0].decisions[0]
  assert.ok(rq.kind === "possible-duplicate" && rq.others[0].registered)

  // A suspicious roll number is a warning: it still imports.
  const warn = planWith([response({ email: "x@x.com", roll: "hello", c1: "UNSC", c2: "" })])
  assert.equal(warn.rows[0].bucket, "warning")

  // A broken row asks to be fixed or skipped; skipping quiets it.
  const bad = planWith([response({ email: "" })])
  assert.equal(bad.rows[0].bucket, "decision")
  assert.equal(planWith([response({ email: "" })], { rows: { [bad.rows[0].rowHash]: "skip" } }).rows[0].bucket, "skipped")
}

console.log("delegate import checks passed (form mapping, resubmission, case, refetch, hand edits, invalid rows, DTU, clashes, committees)")
