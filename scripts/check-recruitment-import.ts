// Runnable check for the Google Sheets response import:
//   npx tsx scripts/check-recruitment-import.ts
//
// Pins the properties the spec demands of imports: idempotent re-import, duplicate
// detection, invalid rows surfaced rather than dropped, and manual candidate edits
// never silently overwritten.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import {
  importIdempotencyKey,
  parseRowTimestamp,
  normalizeHeaders,
  planImport,
  prepareRow,
  rowHash,
  rowKey,
  sheetKeyFromUrl,
  summarisePlan,
  withheldManualEdits,
  type ExistingCandidate,
} from "../src/lib/recruitment/import"
import type { CandidateMapping } from "../src/lib/schemas/recruitment"

const mapping: CandidateMapping = {
  fullName: "Full Name",
  email: "Email Address",
  phone: "WhatsApp Number",
  year: "Year",
  branch: "Branch",
}

const sheetRow = (over: Record<string, string> = {}) => ({
  "Full Name": "asha  rao",
  "Email Address": "ASHA@Gmial.com",
  "WhatsApp Number": "9876543210",
  Year: "2",
  Branch: "CSE",
  ...over,
})

// ── Source identity ─────────────────────────────────────────────────────────
assert.equal(
  sheetKeyFromUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=456"),
  "ABC123:456",
)
// No gid → the first tab.
assert.equal(sheetKeyFromUrl("https://docs.google.com/spreadsheets/d/ABC123/edit"), "ABC123:0")
// Two tabs of one workbook are DIFFERENT sources — their row numbering is independent.
assert.notEqual(
  sheetKeyFromUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0"),
  sheetKeyFromUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=99"),
)
assert.equal(
  sheetKeyFromUrl("https://docs.google.com/spreadsheets/d/e/2PACX-tok/pubhtml"),
  "pub-2PACX-tok:0",
)
assert.equal(sheetKeyFromUrl("https://example.com/not-a-sheet"), null)
assert.equal(sheetKeyFromUrl("   "), null)

// ── Header normalisation ────────────────────────────────────────────────────
assert.deepEqual(normalizeHeaders({ "  Full Name  ": "  Asha  ", Empty: null }), {
  "Full Name": "Asha",
  Empty: "",
})

// ── Row preparation reuses the shared intake normalizers ────────────────────
const prepared = prepareRow(sheetRow(), mapping, 0)
assert.deepEqual(prepared.errors, [])
assert.equal(prepared.candidate?.fullName, "Asha Rao", "name is title-cased and de-spaced")
assert.equal(prepared.candidate?.email, "asha@gmail.com", "the gmial typo is corrected")
assert.equal(prepared.candidate?.phone, "919876543210", "phone gets the country code")
assert.equal(prepared.candidate?.year, "2")
assert.equal(prepared.candidate?.branch, "CSE")

// Unmapped optional columns become null rather than empty strings.
const sparse = prepareRow({ "Full Name": "Bo", "Email Address": "bo@e.com" }, mapping, 0)
assert.equal(sparse.candidate?.phone, null)
assert.equal(sparse.candidate?.year, null)

// Header casing/whitespace drift in the sheet must not drop a mapped column.
const drifted = prepareRow(
  { "  full name ": "Chen Wu", "EMAIL ADDRESS": "chen@e.com", branch: "ECE" },
  mapping,
  0,
)
assert.deepEqual(drifted.errors, [], "case-insensitive header fallback should find the columns")
assert.equal(drifted.candidate?.fullName, "Chen Wu")
assert.equal(drifted.candidate?.branch, "ECE")

// ── Invalid rows are reported, never dropped ────────────────────────────────
const noName = prepareRow(sheetRow({ "Full Name": "" }), mapping, 3)
assert.equal(noName.candidate, null)
assert.ok(noName.errors.some((e) => /full name/i.test(e)))
const noEmail = prepareRow(sheetRow({ "Email Address": "" }), mapping, 4)
assert.ok(noEmail.errors.some((e) => /email/i.test(e)))
// Both problems are collected, not just the first.
const neither = prepareRow({ Year: "1" }, mapping, 5)
assert.equal(neither.errors.length, 2)
// A malformed address is refused with the offending value quoted.
const badEmail = prepareRow(sheetRow({ "Email Address": "not-an-email" }), mapping, 6)
assert.ok(badEmail.errors.some((e) => e.includes("not-an-email")))
assert.equal(badEmail.candidate, null)

// ── Row identity survives re-sorting ───────────────────────────────────────
// Email-based identity means the same person keeps the same key at any position.
assert.equal(
  rowKey(normalizeHeaders(sheetRow()), mapping, 0),
  rowKey(normalizeHeaders(sheetRow()), mapping, 41),
  "row identity must not depend on position when an email is present",
)
assert.equal(rowKey(normalizeHeaders(sheetRow()), mapping, 0), "email:asha@gmail.com")
// Without an email, identity falls back to position + content.
const anon = normalizeHeaders({ "Full Name": "Anon" })
assert.ok(rowKey(anon, mapping, 7).startsWith("row:7:"))
assert.notEqual(rowKey(anon, mapping, 7), rowKey(anon, mapping, 8))

// ── Content hashing is order-independent and change-sensitive ───────────────
assert.equal(
  rowHash({ a: "1", b: "2" }),
  rowHash({ b: "2", a: "1" }),
  "key order in a sheet-derived object is incidental",
)
assert.notEqual(rowHash({ a: "1" }), rowHash({ a: "2" }))

// ── Import idempotency key ─────────────────────────────────────────────────
const rowsA = [sheetRow(), sheetRow({ "Email Address": "b@e.com" })]
const keyArgs = { cycleId: "c1", sourceId: "s1", mapping, rows: rowsA }
assert.equal(importIdempotencyKey(keyArgs), importIdempotencyKey({ ...keyArgs }), "same input → same key")
// Any change in content, mapping, source or cycle produces a different key.
assert.notEqual(
  importIdempotencyKey(keyArgs),
  importIdempotencyKey({ ...keyArgs, rows: [sheetRow()] }),
)
assert.notEqual(importIdempotencyKey(keyArgs), importIdempotencyKey({ ...keyArgs, cycleId: "c2" }))
assert.notEqual(importIdempotencyKey(keyArgs), importIdempotencyKey({ ...keyArgs, sourceId: "s2" }))
assert.notEqual(
  importIdempotencyKey(keyArgs),
  importIdempotencyKey({ ...keyArgs, mapping: { ...mapping, year: "Batch" } }),
)

// ── First import: everything is new ────────────────────────────────────────
const firstRun = planImport([sheetRow(), sheetRow({ "Email Address": "bilal@e.com", "Full Name": "Bilal" })], mapping, [])
assert.equal(firstRun.counts.total, 2)
assert.equal(firstRun.counts.create, 2)
assert.equal(firstRun.counts.update, 0)
assert.equal(firstRun.counts.invalid, 0)

// ── Re-import of an untouched sheet is a genuine no-op ─────────────────────
const existing: ExistingCandidate[] = [
  {
    id: "cand1",
    email: "asha@gmail.com",
    sourceRowKey: "email:asha@gmail.com",
    sourceRowHash: rowHash(normalizeHeaders(sheetRow())),
    manualEditedFields: [],
  },
]
const rerun = planImport([sheetRow()], mapping, existing)
assert.equal(rerun.counts.create, 0, "re-import must not duplicate the candidate")
assert.equal(rerun.counts.update, 0, "an unchanged row must not be rewritten")
assert.equal(rerun.counts.skipUnchanged, 1)
assert.equal(rerun.rows[0].candidateId, "cand1")

// A changed row IS updated.
const edited = planImport([sheetRow({ Branch: "MCE" })], mapping, existing)
assert.equal(edited.counts.update, 1)
assert.equal(edited.rows[0].candidateId, "cand1")
assert.equal(edited.rows[0].changes?.branch, "MCE")

// Matching also works by email when the stored row key predates the source
// (e.g. rows created by the form webhook rather than a sheet import).
const noKeyExisting: ExistingCandidate[] = [
  { id: "cand9", email: "asha@gmail.com", sourceRowKey: null, sourceRowHash: null, manualEditedFields: [] },
]
const matchedByEmail = planImport([sheetRow()], mapping, noKeyExisting)
assert.equal(matchedByEmail.counts.create, 0, "must match an existing candidate by email")
assert.equal(matchedByEmail.counts.update, 1)
assert.equal(matchedByEmail.rows[0].candidateId, "cand9")

// ── Duplicates inside a single sheet ──────────────────────────────────────
// A form that recorded the same person twice yields ONE candidate and a reported
// duplicate — not two rows racing for the same unique constraint.
const dupes = planImport([sheetRow(), sheetRow({ Branch: "ECE" })], mapping, [])
assert.equal(dupes.counts.create, 1)
assert.equal(dupes.counts.skipDuplicate, 1)
// With no timestamp mapped the LAST row wins: a response sheet appends, so the
// later row is the newer submission. It used to be the first, which meant a
// resubmitted correction was the one thrown away.
assert.equal(dupes.rows[0].outcome, "skip-duplicate")
assert.equal(dupes.rows[1].outcome, "create")
assert.equal(dupes.rows[1].changes?.branch, "ECE", "the surviving row is the later one")
assert.ok(dupes.rows[0].errors?.[0].includes("asha@gmail.com"))
// Case and typo differences still collapse to the same identity.
const dupesFuzzy = planImport([sheetRow(), sheetRow({ "Email Address": "  Asha@GMAIL.com " })], mapping, [])
assert.equal(dupesFuzzy.counts.create, 1)
assert.equal(dupesFuzzy.counts.skipDuplicate, 1)

// ── Manual edits are never silently overwritten ───────────────────────────
const handEdited: ExistingCandidate[] = [
  {
    id: "cand1",
    email: "asha@gmail.com",
    sourceRowKey: "email:asha@gmail.com",
    sourceRowHash: "stale-hash",
    // An operator fixed the phone number by hand.
    manualEditedFields: ["phone"],
  },
]
const respectful = planImport([sheetRow({ "WhatsApp Number": "1111111111" })], mapping, handEdited)
assert.equal(respectful.counts.update, 1)
assert.equal(respectful.rows[0].changes?.phone, undefined, "a hand-edited phone must not be overwritten")
assert.deepEqual(respectful.rows[0].protectedFields, ["phone"])
// Other fields still update.
assert.equal(respectful.rows[0].changes?.branch, "CSE")

// withheldManualEdits directly.
const candidate = { fullName: "A", email: "a@e.com", phone: "1", year: "2", branch: "CSE" }
const withheld = withheldManualEdits(candidate, ["fullName", "year"])
assert.deepEqual(withheld.protectedFields.sort(), ["fullName", "year"])
assert.equal(withheld.changes.fullName, undefined)
assert.equal(withheld.changes.year, undefined)
assert.equal(withheld.changes.branch, "CSE")
// Email is a candidate's identity in the cycle — an import never rewrites it,
// even when it isn't in the manual-edit list.
assert.equal(withheld.changes.email, undefined, "import must never change a candidate's email")
assert.equal(withheldManualEdits(candidate, []).changes.email, undefined)
// Everything locked → nothing written.
assert.deepEqual(withheldManualEdits(candidate, ["fullName", "email", "phone", "year", "branch"]).changes, {})

// ── Invalid rows do not stop the good ones ───────────────────────────────
const mixed = planImport(
  [sheetRow(), { Year: "1" }, sheetRow({ "Email Address": "cara@e.com", "Full Name": "Cara" })],
  mapping,
  [],
)
assert.equal(mixed.counts.total, 3)
assert.equal(mixed.counts.create, 2, "valid rows still import")
assert.equal(mixed.counts.invalid, 1)
assert.equal(mixed.rows[1].outcome, "invalid")
assert.ok((mixed.rows[1].errors?.length ?? 0) > 0, "the invalid row keeps its reasons for display")
assert.ok(mixed.rows[1].raw, "the raw row is retained so the operator can see what failed")

// An empty sheet is valid and does nothing.
const empty = planImport([], mapping, [])
assert.equal(empty.counts.total, 0)
assert.deepEqual(empty.rows, [])

// Counts always add up to the row total — no row is ever unaccounted for.
for (const plan of [firstRun, rerun, edited, dupes, mixed, respectful, empty]) {
  const c = plan.counts
  assert.equal(
    c.create + c.update + c.skipUnchanged + c.skipDuplicate + c.invalid,
    c.total,
    "every row must be accounted for in exactly one bucket",
  )
  assert.equal(plan.rows.length, c.total)
}

assert.ok(summarisePlan(mixed).includes("3 rows"))

// ---------------------------------------------------------------------------
// Duplicate resolution: latest submission wins, and the operator can override
// ---------------------------------------------------------------------------
//
// The old rule kept whichever row came FIRST. On a form response sheet that is
// the OLDEST submission, so someone who resubmitted to correct their answers had
// the correction silently discarded.
{
  const mapping = {
    fullName: "Name",
    email: "Email",
    timestamp: "Timestamp",
  } as unknown as CandidateMapping

  const rows = [
    { Name: "Asha Old", Email: "asha@example.com", Timestamp: "8/24/2026 10:14:00" },
    { Name: "Bo Only", Email: "bo@example.com", Timestamp: "8/24/2026 11:00:00" },
    { Name: "Asha New", Email: "asha@example.com", Timestamp: "8/26/2026 18:52:00" },
  ]

  const plan = planImport(rows, mapping, [])
  const created = plan.rows.filter((r) => r.outcome === "create")
  assert.equal(created.length, 2, "one row per person")
  assert.ok(
    created.some((r) => r.candidate?.fullName === "Asha New"),
    "the LATER submission must win, not the first one in the sheet",
  )
  assert.equal(plan.counts.skipDuplicate, 1)

  const group = plan.duplicateGroups.find((g) => g.email === "asha@example.com")
  assert.ok(group, "the duplicate must be reported, not silently dropped")
  assert.equal(group!.byTimestamp, true, "and reported as resolved by timestamp")
  assert.equal(group!.winnerIndex, 2)
  assert.equal(group!.rowIndexes[0], 2, "the winner is listed first for the preview")

  // The operator overrides the automatic choice.
  const forced = planImport(rows, mapping, [], { "asha@example.com": 0 })
  assert.ok(
    forced.rows.some((r) => r.outcome === "create" && r.candidate?.fullName === "Asha Old"),
    "an explicit override must beat the timestamp",
  )

  // With no timestamp mapped, fall back to the LAST row rather than the first:
  // a response sheet appends, so the last row is the newest submission.
  const noStamp = { fullName: "Name", email: "Email" } as unknown as CandidateMapping
  const fallback = planImport(rows, noStamp, [])
  const fbGroup = fallback.duplicateGroups.find((g) => g.email === "asha@example.com")!
  assert.equal(fbGroup.byTimestamp, false)
  assert.equal(fbGroup.winnerIndex, 2, "last row wins when there is no timestamp")
}

// Timestamp parsing has to survive the formats Sheets and the CSV reader produce.
// A month/day swap would pick the wrong submission for 12 days of every year.
{
  const iso = (v: string) => new Date(parseRowTimestamp(v)!).toISOString()

  assert.equal(iso("8/24/2026 20:32:29"), "2026-08-24T20:32:29.000Z", "US order with time")
  assert.equal(iso("8/24/26"), "2026-08-24T00:00:00.000Z", "two-digit year, time dropped by the reader")
  assert.equal(iso("24/8/2026 20:32:29"), "2026-08-24T20:32:29.000Z", "day-first when >12 disambiguates")
  assert.equal(iso("2026-08-24T20:32:29"), "2026-08-24T20:32:29.000Z", "ISO")

  // Ordering within a day must survive, or same-day resubmissions tie.
  assert.ok(
    parseRowTimestamp("8/24/2026 20:33:37")! > parseRowTimestamp("8/24/2026 20:32:29")!,
    "same-day submissions must stay ordered",
  )

  assert.equal(parseRowTimestamp(""), null)
  assert.equal(parseRowTimestamp(undefined), null)
  assert.equal(parseRowTimestamp("not a date"), null)
}

// The idempotency key must change when the operator picks a different winner,
// or the corrected import would be swallowed as a repeat of the first one.
{
  const args = {
    cycleId: "c1",
    sourceId: "s1",
    mapping: { fullName: "Name", email: "Email" } as unknown as CandidateMapping,
    rows: [{ Name: "A", Email: "a@example.com" }],
  }
  assert.notEqual(
    importIdempotencyKey({ ...args, overrides: { "a@example.com": 0 } }),
    importIdempotencyKey({ ...args, overrides: { "a@example.com": 1 } }),
    "a different duplicate choice is a different import",
  )
  assert.equal(
    importIdempotencyKey(args),
    importIdempotencyKey({ ...args, overrides: {} }),
    "no overrides must hash the same as an empty override map",
  )
}

// Prisma's `string_contains` matches a string VALUE at a JSON path, NOT anywhere
// in the document, so using it to search a whole form response silently returned
// nothing. Verified against 254 real candidates: it found 0 for terms present in
// 19 of them. The candidate list must therefore use a raw text search.
{
  const page = readFileSync("src/app/(recruitment)/recruitment/candidates/page.tsx", "utf8")
  assert.doesNotMatch(
    page,
    /formAnswers: \{ string_contains/,
    "string_contains cannot search a whole JSON document: use the raw text search",
  )
  assert.match(page, /formAnswerMatches/, "the candidate list must search inside form answers")
  assert.match(page, /"formAnswers"::text ILIKE/, "and must do it with a text match")
}

console.log("recruitment import checks passed (identity, idempotency, duplicates, manual-edit protection)")
