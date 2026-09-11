#!/usr/bin/env tsx
import assert from "node:assert"
import { ContentSchema } from "../src/content/contentSchema"
import { automaticIntakeAllowed, deriveEventState } from "../src/lib/event-state"
import { readFileSync } from "node:fs"

const society = ContentSchema.parse({
  eventMode: "SOCIETY",
  paymentsEnabled: true,
  publicSections: { activeEvent: true },
  activeEventName: "Old event",
})
assert.equal(deriveEventState(society).paymentsRequired, false)
assert.equal(deriveEventState(society).showEventHero, false)
assert.equal(deriveEventState(society).acceptsRegistrations, false)

const intra = ContentSchema.parse({
  eventMode: "INTRA_MUN",
  paymentsEnabled: true,
  publicSections: { activeEvent: true },
  activeEventName: "DTU Intra",
})
assert.equal(deriveEventState(intra).paymentsRequired, false)
assert.equal(deriveEventState(intra).showEventHero, true)

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
    "src/app/(admin)/admin/import/actions.ts",
  ]) {
    assert.match(readFileSync(file, "utf8"), /automaticIntakeAllowed\(/, `${file} must gate on automaticIntakeAllowed`)
  }
}

console.log("✅ check-event-state passed")
