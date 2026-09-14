#!/usr/bin/env tsx
import assert from "node:assert"
import { ContentSchema } from "../src/content/contentSchema"
import { automaticIntakeAllowed, deriveEventState } from "../src/lib/event-state"
import { eventOverlay } from "../src/lib/event-overlay"
import { readFileSync } from "node:fs"

const society = ContentSchema.parse({
  eventMode: "SOCIETY",
  paymentsEnabled: true,
  publicSections: { activeEvent: true },
  activeEventName: "Old event",
})
// Society is the resting state: no event, so nothing is charged or open. getContent
// forces these to false whenever it finds no active event, which is what makes the
// capability flags safe to trust on their own.
const restingSociety = ContentSchema.parse({ eventMode: "SOCIETY", paymentsEnabled: false })
assert.equal(deriveEventState(restingSociety).paymentsRequired, false)
assert.equal(deriveEventState(society).showEventHero, false)
assert.equal(deriveEventState(society).acceptsRegistrations, false)

// A free event is free because its capability says so, not because of its name.
const intraFree = ContentSchema.parse({
  eventMode: "INTRA_MUN",
  paymentsEnabled: false,
  publicSections: { activeEvent: true },
  activeEventName: "DTU Intra",
})
assert.equal(deriveEventState(intraFree).paymentsRequired, false)
assert.equal(deriveEventState(intraFree).showEventHero, true)

// The decoupling itself: an Intra that is configured to charge, does. This used to
// be impossible, because payments were welded to the CONFERENCE name, so a new kind
// of paid event meant editing deriveEventState and every caller.
const intraPaid = ContentSchema.parse({
  eventMode: "INTRA_MUN",
  paymentsEnabled: true,
  publicSections: { activeEvent: true },
  activeEventName: "DTU Intra",
})
assert.equal(
  deriveEventState(intraPaid).paymentsRequired,
  true,
  "capabilities decide what an event charges, never the name of its mode",
)

const conference = ContentSchema.parse({
  eventMode: "CONFERENCE",
  paymentsEnabled: true,
  publicSections: { activeEvent: true },
  activeEventName: "DelTech MUN",
})
assert.equal(deriveEventState(conference).paymentsRequired, true)
assert.equal(deriveEventState(conference).showEventHero, true)

// ── Automatic intake: the rule every unreviewed path must ask ─────────────────
{
  const open = (mode: "INTRA_MUN" | "CONFERENCE" | "SOCIETY", registrationOpen = true) =>
    ContentSchema.parse({ eventMode: mode, registrationOpen })

  assert.equal(automaticIntakeAllowed(open("CONFERENCE"), "SELF").ok, true)
  assert.equal(automaticIntakeAllowed(open("CONFERENCE"), "CROSS_DEL").ok, true, "a conference takes cross-delegations")
  assert.equal(automaticIntakeAllowed(open("INTRA_MUN"), "SELF").ok, true)
  assert.equal(
    automaticIntakeAllowed(open("INTRA_MUN"), "CROSS_DEL").ok,
    false,
    "the DTU-only Intra must refuse cross-delegation intake, which auto-confirms and auto-allots",
  )
  assert.equal(automaticIntakeAllowed(open("CONFERENCE", false), "SELF").ok, false, "closed registration must refuse")
  assert.equal(automaticIntakeAllowed(open("SOCIETY"), "SELF").ok, false, "society mode takes no registrations")

  // The rule only helps if every automatic path actually asks it.
  for (const file of [
    "src/app/api/webhooks/gform/route.ts",
    "src/app/api/cron/gform-sync/route.ts",
    "src/app/(admin)/admin/(event)/import/actions.ts",
  ]) {
    assert.match(readFileSync(file, "utf8"), /automaticIntakeAllowed\(/, `${file} must gate on automaticIntakeAllowed`)
  }
}

// ── The event decides what the website shows ────────────────────────────────
{
  const intra = { name: "DTU Intra", kind: "INTRA_MUN", registrationOpen: true, paymentsEnabled: false, matrixPublic: true }
  const draft = eventOverlay({ ...intra, state: "DRAFT" }, { dispatch: true })
  assert.equal(draft.registrationOpen, false, "a draft event takes no registrations, whatever its switch says")
  assert.equal(draft.matrixPublic, false, "a draft event's matrix is not public")
  assert.deepEqual(
    draft.publicSections,
    { dispatch: true, activeEvent: false, registration: false, committees: false, matrix: false },
    "a draft event shows nothing on the website",
  )

  // The bug this replaced: the event read "Registration open" in admin while old
  // site switches hid it from the website.
  const open = eventOverlay({ ...intra, state: "OPEN" }, { activeEvent: false, registration: false, committees: false, matrix: false, dispatch: false })
  const sections = open.publicSections as Record<string, boolean>
  assert.equal(sections.activeEvent && sections.registration && sections.committees && sections.matrix, true, "a published event shows on the website")
  assert.equal(sections.dispatch, false, "the society's own switches are left alone")
  assert.equal(open.registrationOpen, true)
  assert.equal(open.eventMode, "INTRA_MUN")

  const hiddenMatrix = eventOverlay({ ...intra, state: "LIVE", matrixPublic: false }, {})
  assert.equal((hiddenMatrix.publicSections as Record<string, boolean>).matrix, false, "the matrix keeps its own switch")

  const resting = eventOverlay(null, { activeEvent: true, registration: true })
  assert.equal((resting.publicSections as Record<string, boolean>).activeEvent, false, "no event, nothing about an event on show")
  assert.equal(resting.eventMode, "SOCIETY")
  assert.equal(eventOverlay({ ...intra, state: "OPEN", kind: "SOMETHING_NEW" }, {}).eventMode, "CONFERENCE", "an unknown kind cannot break the site")
}

console.log("✅ check-event-state passed")
