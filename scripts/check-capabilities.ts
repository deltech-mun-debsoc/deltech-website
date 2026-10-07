#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-capabilities.ts
//
// The workspace offers what the running event can do, and refuses the rest on
// the server too. These pin the capability rule, that every cross-delegation
// action actually asks it before doing work, and the stage a delegate is shown:
// "Confirmed" must never be said about someone who holds no seat.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { eventCapabilities } from "../src/lib/event-state"
import { stageOf, NEEDS_SEAT } from "../src/app/(admin)/admin/(event)/registrations/_lib/status"
import { buildDelegateWhere } from "../src/app/(admin)/admin/(event)/registrations/_lib/build-where"
import { delegateFacingStatus } from "../src/lib/status-labels"

// ── Capabilities ─────────────────────────────────────────────────────────────
{
  const intra = { kind: "INTRA_MUN", paymentsEnabled: false, matrixPublic: true, crossDelegationsEnabled: true }
  const caps = eventCapabilities(intra, true)
  assert.equal(caps.intra, true)
  assert.equal(caps.payments, false, "a free Intra charges nothing")
  assert.equal(caps.crossDelegations, false, "an Intra never takes cross delegations, even switched on and in use")

  const paid = { kind: "CONFERENCE", paymentsEnabled: true, matrixPublic: false, crossDelegationsEnabled: true }
  assert.deepEqual(eventCapabilities(paid, false), { intra: false, payments: true, crossDelegations: true, matrixPublic: false })

  const off = { ...paid, crossDelegationsEnabled: false }
  assert.equal(eventCapabilities(off, false).crossDelegations, false, "a conference with the switch off hides intake")
  assert.equal(
    eventCapabilities(off, true).crossDelegations,
    true,
    "switching it off must not hide cross delegates who are already there",
  )

  assert.deepEqual(eventCapabilities(null, true), { intra: false, payments: false, crossDelegations: false, matrixPublic: false })
}

// ── Every cross-delegation entry point asks before doing work ─────────────────
{
  const read = (f: string) => readFileSync(f, "utf8")
  const actions = read("src/app/(admin)/admin/(event)/import/actions.ts")
  for (const fn of ["parseUpload", "commitImport", "retryQuarantined", "savePartnerSheets"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}(`))
    const end = body.indexOf("\nexport ", 1)
    assert.match(
      end > 0 ? body.slice(0, end) : body,
      /crossDelegationRefusal\(\)/,
      `${fn} must refuse when the event takes no cross delegations`,
    )
  }
  const ai = read("src/app/(admin)/admin/(event)/import/actions-ai.ts")
  assert.equal(ai.match(/requireCapability\("crossDelegations"\)/g)?.length, 2, "both AI actions must ask before spending tokens")

  assert.match(read("src/app/(admin)/admin/(event)/import/page.tsx"), /crossDelegations\) redirect\(/, "the page must not render the wizard")
  assert.match(read("src/app/(admin)/admin/(event)/registrations/_components/delegate-tabs.tsx"), /caps\.crossDelegations/)
  assert.match(
    read("src/app/(admin)/admin/(event)/config/actions.ts"),
    /"sheetPullSources" in partial/,
    "the generic content save must not be a way around savePartnerSheets",
  )
  assert.match(
    read("src/app/(admin)/admin/(event)/registrations/actions.ts"),
    /regeneratePaymentLink[\s\S]{0,400}getEventCapabilities\(\)\)\.payments/,
    "a free event must refuse a pay link on the server",
  )
}

// ── Stages ───────────────────────────────────────────────────────────────────
{
  const sent = { emailSentAt: "2026-10-01T00:00:00Z" }
  const draft = { emailSentAt: null }
  assert.equal(stageOf({ status: "CONFIRMED", allotment: null }).label, "Accepted, needs a seat")
  assert.equal(stageOf({ status: "CONFIRMED", allotment: draft }).label, "Accepted, seat not sent")
  assert.equal(stageOf({ status: "CONFIRMED", allotment: sent }).label, "Confirmed")
  assert.equal(stageOf({ status: "REGISTERED", allotment: draft }).label, "Seat drafted")
  assert.equal(stageOf({ status: "REGISTERED", allotment: null }).label, "Waiting")

  assert.equal(delegateFacingStatus("CONFIRMED", null), "ACCEPTED", "a delegate is never told Confirmed without a seat")
  assert.equal(delegateFacingStatus("CONFIRMED", { emailSentAt: null }), "ACCEPTED")
  assert.equal(delegateFacingStatus("CONFIRMED", { emailSentAt: new Date() }), "CONFIRMED")
  assert.equal(delegateFacingStatus("REGISTERED", { emailSentAt: null }), "REGISTERED", "a draft seat stays staff-only")
  assert.equal(delegateFacingStatus("PAYMENT_SENT", { emailSentAt: new Date() }), "PAYMENT_SENT")

  assert.deepEqual(buildDelegateWhere({ status: NEEDS_SEAT }), { status: "CONFIRMED", allotment: { is: null } })
  assert.deepEqual(
    buildDelegateWhere({ status: "CONFIRMED" }),
    { status: "CONFIRMED", allotment: { isNot: null } },
    "the Confirmed filter must not list people without a seat",
  )
}

console.log("✅ check-capabilities passed (free Intra, paid conference, intake in use; seatless never 'Confirmed')")
