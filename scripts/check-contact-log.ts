#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-contact-log.ts
//
// The follow-up log only helps if the chase list it drives is right. A "due"
// filter that lists people already called back, or a "never contacted" filter
// that silently drops a status filter, sends a volunteer ringing the wrong people.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { buildDelegateWhere } from "../src/app/(admin)/admin/registrations/_lib/build-where"

const now = new Date("2026-09-14T10:00:00.000Z")

// ── due: the latest follow-up date has passed ───────────────────────────────
{
  const w = buildDelegateWhere({ followUp: "due" }, now)
  assert.deepEqual(w.AND, [{ nextFollowUpAt: { lte: now } }])
}

// ── never: allotted, unpaid, and nobody has logged a call ───────────────────
{
  const w = buildDelegateWhere({ followUp: "never" }, now)
  assert.deepEqual(w.AND, [{ lastContactedAt: null, status: { in: ["ALLOTTED", "PAYMENT_SENT"] } }])
}

// ── It narrows other filters instead of replacing them ──────────────────────
{
  const w = buildDelegateWhere({ followUp: "due", status: "PAYMENT_SENT", q: "ria" }, now)
  assert.equal(w.status, "PAYMENT_SENT", "a status filter must survive the follow-up filter")
  assert.equal((w.AND as unknown[]).length, 2, "search and follow-up must both apply")
}

// ── Anything else is ignored rather than guessed at ─────────────────────────
{
  assert.equal(buildDelegateWhere({ followUp: "overdue" }, now).AND, undefined)
  assert.equal(buildDelegateWhere({}, now).AND, undefined)
}

// ── The log and the delegate columns cannot drift ───────────────────────────
// Registrations filters on lastContactedAt / nextFollowUpAt. If the entry could
// be written without them, "due" would list people who were already called.
{
  const src = readFileSync("src/app/(admin)/admin/registrations/actions.ts", "utf8")
  const fn = src.slice(src.indexOf("export async function logContact"))
  const tx = fn.slice(fn.indexOf("prisma.$transaction"), fn.indexOf("return { success: true"))
  assert.match(tx, /tx\.delegateContact\.create/, "the entry must be written inside the transaction")
  assert.match(tx, /tx\.delegate\.update/, "the delegate columns must be updated inside the same transaction")
}

// ── The Registrations list is scoped to the current event ───────────────────
// It computed the scope and applied it only to the committee dropdown, so the
// delegate list spanned every event. A grep for currentEventScope( passed anyway,
// which is why this checks the where clause itself.
{
  const page = readFileSync("src/app/(admin)/admin/registrations/page.tsx", "utf8")
  assert.match(
    page,
    /const where: Prisma\.DelegateWhereInput = \{\s*\.\.\.buildDelegateWhere\([\s\S]*?\),\s*\.\.\.scope,\s*\}/,
    "the delegate list and count must spread the current-event scope into their where clause",
  )
}

console.log("contact log checks passed (due, never, filter narrowing, atomic log, scoped list)")
