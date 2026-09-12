#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-visible-poll.ts
//
// The availability boards poll instead of subscribing (the database is leaving
// Supabase, and postgres_changes goes with it). Two rules matter: a hidden tab
// never refreshes, and a visible one refreshes no faster than its interval.
import assert from "node:assert"
import { shouldRefresh } from "../src/lib/use-visible-poll"

const INTERVAL = 20_000

assert.equal(
  shouldRefresh({ visible: false, now: 1_000_000, lastRun: 0, intervalMs: INTERVAL }),
  false,
  "a hidden tab must never refresh, however long it has been stale",
)

assert.equal(
  shouldRefresh({ visible: true, now: 19_999, lastRun: 0, intervalMs: INTERVAL }),
  false,
  "a visible tab must not refresh before its interval has elapsed",
)

assert.equal(
  shouldRefresh({ visible: true, now: 20_000, lastRun: 0, intervalMs: INTERVAL }),
  true,
  "the interval boundary counts as elapsed, or a 5s ticker never fires on time",
)

assert.equal(
  shouldRefresh({ visible: true, now: 60_000, lastRun: 55_000, intervalMs: INTERVAL }),
  false,
  "returning to a tab refreshed 5s ago must not trigger another render",
)

console.log("visible poll checks passed (hidden tabs idle, interval respected)")
