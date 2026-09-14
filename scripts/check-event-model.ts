#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-event-model.ts
//
// Events are first-class rows, and three things about that have to stay true.
// None of them fail loudly on their own if they regress: the site would simply
// start mixing two events together, or turn a returning delegate away.
import assert from "node:assert"
import { readFileSync } from "node:fs"

const migration = readFileSync(
  "prisma/migrations/20260913110000_event_model/migration.sql",
  "utf8",
)
const schema = readFileSync("prisma/schema.prisma", "utf8")

// Just the Delegate block: User.email is legitimately unique across the whole
// site, and must not be confused for the delegate identity rule below.
const delegateModel = schema.match(/^model Delegate \{[\s\S]*?^\}/m)?.[0] ?? ""
assert.ok(delegateModel, "could not find the Delegate model in the schema")

// ── 1. Identity is per event ────────────────────────────────────────────────
// This is what lets somebody who attended a previous conference register for the
// next one. A global unique index on Delegate.email would silently bring the
// collision back.
{
  assert.match(
    delegateModel,
    /@@unique\(\[eventId, email\]\)/,
    "Delegate identity must be scoped to its event",
  )
  assert.doesNotMatch(
    delegateModel,
    /^\s*email\s+String\s+@unique/m,
    "Delegate.email must not be globally unique again: a returning delegate would collide",
  )
  assert.match(migration, /DROP INDEX IF EXISTS "Delegate_email_key"/)
  assert.match(migration, /CREATE UNIQUE INDEX "Delegate_eventId_email_key"/)
}

// ── 2. Only one event runs at a time ────────────────────────────────────────
// Committee and Delegate are still queried globally in most of the app. Those
// queries are correct only while a single event is active, so the database
// enforces it rather than the code hoping for it.
{
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "Event_single_active_idx"[\s\S]*?WHERE "state" NOT IN \('CLOSED', 'ARCHIVED'\)/,
    "a partial unique index must keep at most one event outside CLOSED/ARCHIVED",
  )
}

// ── 3. The backfill cannot orphan or reinterpret existing rows ──────────────
// Adding NOT NULL before the backfill would fail on a populated database, and
// treating the old SOCIETY mode as a kind of running event would switch the
// public event hero on by itself.
{
  const addColumn = migration.indexOf('ALTER TABLE "Committee" ADD COLUMN "eventId"')
  const backfill = migration.indexOf('UPDATE "Committee" SET "eventId"')
  const setNotNull = migration.indexOf('ALTER TABLE "Committee" ALTER COLUMN "eventId" SET NOT NULL')
  assert.ok(addColumn !== -1 && backfill !== -1 && setNotNull !== -1)
  assert.ok(
    addColumn < backfill && backfill < setNotNull,
    "columns must be added nullable, backfilled, and only then made NOT NULL",
  )

  assert.match(
    migration,
    /IF raw_mode IS NULL OR raw_mode = 'SOCIETY' THEN[\s\S]*?event_state := 'CLOSED';/,
    "SOCIETY meant no event was running, so it must migrate to CLOSED, not to a live event",
  )
  assert.match(
    migration,
    /IF raw_mode IS DISTINCT FROM 'CONFERENCE' THEN\s*\n\s*pay_on := false;/,
    "payments were only ever honoured for a conference, so a stale flag must not start charging",
  )
}

// ── 4. Capabilities decide behaviour, not the name of the mode ──────────────
{
  const eventState = readFileSync("src/lib/event-state.ts", "utf8")
  assert.doesNotMatch(
    eventState,
    /paymentsRequired:\s*isConference/,
    "what an event charges must come from its capability, never from its mode name",
  )
}


// ── 5. Lists are scoped to the event being run ──────────────────────────────
// Once a second event exists, an unscoped list quietly blends the two: last
// year's delegates appear in this year's registrations, exports and counts.
// Nothing fails loudly when that happens, so it is pinned here instead.
{
  const mustScope = [
    "src/app/(admin)/admin/(event)/registrations/page.tsx",
    "src/app/(admin)/admin/(event)/allotment/page.tsx",
    "src/app/(admin)/admin/(event)/checkin/page.tsx",
    "src/app/(admin)/admin/(event)/participants/page.tsx",
    "src/app/(admin)/admin/(event)/page.tsx",
    "src/app/(marketing)/availability/page.tsx",
    "src/app/(marketing)/register/page.tsx",
    "src/app/api/admin/export/route.ts",
    "src/app/api/cron/payment-reminder/route.ts",
  ]
  for (const file of mustScope) {
    assert.match(
      readFileSync(file, "utf8"),
      /currentEventScope\(/,
      `${file} lists delegates or committees, so it must scope to the current event`,
    )
  }

  // No active event must match nothing, not everything. Matching everything would
  // show a closed event's delegates as though they were current.
  const lib = readFileSync("src/lib/event.ts", "utf8")
  assert.match(
    lib,
    /eventId: event\?\.id \?\? "__no-active-event__"/,
    "with no event running, the scope must match nothing rather than falling through to every row",
  )
}


// ── 6. The event form follows the event ─────────────────────────────────────
// EventControl seeds its fields from content once, on mount. Starting or closing
// an event from the card beside it changes the event without a navigation, so
// unless the form is keyed by the event it keeps the old name and switches, and
// Apply writes them onto the new event. Found on staging, pinned here.
{
  const page = readFileSync("src/app/(admin)/admin/(event)/config/page.tsx", "utf8")
  assert.match(
    page,
    /<EventControl\s+key=\{event\?\.id \?\? "no-event"\}/,
    "EventControl must be keyed by the active event so its form resets when the event changes",
  )
}

console.log("event model checks passed (per-event identity, one live event, safe backfill, scoped lists)")
