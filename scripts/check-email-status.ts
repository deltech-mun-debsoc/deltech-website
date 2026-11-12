#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-email-status.ts
//
// A delegate's email history says what actually happened, and sending is a
// deliberate act on the delegate's current state, not a replay of an old row.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { nextEmailStatus } from "../src/lib/email-status"
import { addressBlockedIn, emailSummary } from "../src/app/(admin)/admin/(event)/registrations/_lib/status"

// ── Provider events only move an email forward ───────────────────────────────
assert.equal(nextEmailStatus("SENT", "DELIVERED"), "DELIVERED")
assert.equal(nextEmailStatus("SENT", "DEFERRED"), "DEFERRED")
assert.equal(nextEmailStatus("DEFERRED", "DELIVERED"), "DELIVERED", "a delayed mail that arrives is delivered")
assert.equal(nextEmailStatus("BOUNCED", "DELIVERED"), "BOUNCED", "a late delivery event never hides a bounce")
assert.equal(nextEmailStatus("DELIVERED", "COMPLAINED"), "COMPLAINED", "a complaint follows delivery and wins")
assert.equal(nextEmailStatus("FAILED", "BOUNCED"), "FAILED", "nothing follows a send that never left")

// ── The heading counts outcomes, and alerts only on what is still wrong ─────
{
  const at = (d: number) => `2026-10-0${d}T10:00:00Z`
  const fixed = emailSummary([
    { template: "allotment", status: "FAILED", sentAt: at(1) },
    { template: "allotment", status: "DELIVERED", sentAt: at(2) },
    { template: "registration-received", status: "SENT", sentAt: at(1) },
  ])
  assert.equal(fixed.hint, "2 sent · 1 failed", "failures are not counted as sent")
  assert.equal(fixed.alert, false, "a failure later sent successfully is history, not an alert")

  const bounced = emailSummary([
    { template: "allotment", status: "SENT", sentAt: at(1) },
    { template: "payment-reminder", status: "BOUNCED", sentAt: at(2) },
  ])
  assert.equal(bounced.hint, "1 sent · 1 bounced")
  assert.equal(bounced.alert, true)
  assert.equal(emailSummary([]).hint, "none yet")
}

// ── A bounced address is fixed, not retried; fixing it reopens sending ──────
{
  const logs = [
    { toEmail: "old@x.in", status: "BOUNCED", sentAt: "2026-10-02T00:00:00Z" },
    { toEmail: "old@x.in", status: "SENT", sentAt: "2026-10-01T00:00:00Z" },
  ]
  assert.equal(addressBlockedIn(logs, "OLD@x.in"), "BOUNCED")
  assert.equal(addressBlockedIn(logs, "new@x.in"), null, "a corrected address is not blocked")
  assert.equal(addressBlockedIn([...logs, { toEmail: "old@x.in", status: "DELIVERED", sentAt: "2026-10-03T00:00:00Z" }], "old@x.in"), null)
}

// ── Sending builds the current notice for the current address ───────────────
{
  const drawer = readFileSync("src/app/(admin)/admin/(event)/registrations/_components/delegate-drawer.tsx", "utf8")
  assert.doesNotMatch(drawer, /Send again/, "history rows must not offer to 'send again' something that is not the same email")
  assert.match(drawer, /sendNoticeNow\(/, "sending lives in the delegate's next-action box")
  const resend = readFileSync("src/lib/resend.ts", "utf8")
  assert.doesNotMatch(resend, /resendByLogId/, "the old log-row replay is gone")
  assert.match(resend, /addressBlocked\(target\)/, "a bounced or spam-flagged address is refused")
  assert.match(resend, /providerMessageId: messageId/, "the provider's id is stored so events land on the right row")
  const reminder = readFileSync("src/app/api/cron/payment-reminder/route.ts", "utf8")
  assert.match(reminder, /addressBlocked\(c\.email\)/, "reminders skip an address that bounced")
}

console.log("✅ check-email-status passed (event precedence, honest counts, blocked addresses, current notices)")
