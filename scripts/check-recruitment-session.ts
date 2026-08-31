// Runnable check for server-authoritative session timing and the concurrency
// decisions: npx tsx scripts/check-recruitment-session.ts
//
// These are the cases the spec calls out by name: double start, double stop,
// two maintainers on one session, a disconnected owner, client clock
// manipulation, and stale UI overriding newer state. All of them are decided by
// pure functions here so they can be tested without a database; the DB-level
// races (unique indexes, transactions) are covered by
// scripts/check-recruitment-concurrency.ts.
import assert from "node:assert"
import {
  CONTROL_LEASE_MS,
  STALE_AFTER_MS,
  accumulatedPauseMs,
  clockSkewMs,
  decideAbort,
  decideFinish,
  decidePause,
  decideReopen,
  decideResume,
  decideStart,
  displayState,
  elapsedMs,
  formatElapsed,
  isStale,
  nextControlExpiry,
  skewCorrectedNow,
  type SessionSnapshot,
  type SessionStateName,
} from "../src/lib/recruitment/session"

const T0 = new Date("2026-07-29T10:00:00.000Z")
const at = (ms: number) => new Date(T0.getTime() + ms)
const SEC = 1000
const MIN = 60 * SEC

const blank: SessionSnapshot = {
  id: "s1",
  state: "NOT_STARTED",
  version: 0,
  controllerId: null,
  controlExpiresAt: null,
  startedAt: null,
  pausedAt: null,
  endedAt: null,
  pausedMs: 0,
  lastActivityAt: null,
}
const s = (over: Partial<SessionSnapshot>): SessionSnapshot => ({ ...blank, ...over })

const ME = "u-maintainer-1"
const OTHER = "u-maintainer-2"
const input = (over: Partial<Parameters<typeof decideStart>[1]> = {}) => ({
  actorId: ME,
  serverNow: at(10 * MIN),
  ...over,
})

// ── Elapsed time is derived purely from server timestamps ───────────────────
assert.equal(elapsedMs(blank, at(5 * MIN)), 0, "a session that never started has no elapsed time")

const active = s({ state: "ACTIVE", startedAt: T0 })
assert.equal(elapsedMs(active, at(90 * SEC)), 90 * SEC)
// Refreshing, switching device or opening a second tab recomputes the SAME value —
// there is no client-held state to reset.
assert.equal(elapsedMs(active, at(90 * SEC)), elapsedMs({ ...active }, at(90 * SEC)))

// A completed session is frozen at endedAt, no matter how much later we ask.
const done = s({ state: "COMPLETED", startedAt: T0, endedAt: at(12 * MIN) })
assert.equal(elapsedMs(done, at(12 * MIN)), 12 * MIN)
assert.equal(elapsedMs(done, at(99 * MIN)), 12 * MIN, "elapsed must freeze once the session ends")

// Paused: the open pause window does not accrue elapsed time.
const paused = s({ state: "PAUSED", startedAt: T0, pausedAt: at(5 * MIN), pausedMs: 0 })
assert.equal(elapsedMs(paused, at(5 * MIN)), 5 * MIN)
assert.equal(elapsedMs(paused, at(20 * MIN)), 5 * MIN, "a paused clock must not advance")
assert.equal(accumulatedPauseMs(paused, at(20 * MIN)), 15 * MIN)
assert.equal(accumulatedPauseMs(active, at(20 * MIN)), 0, "not paused → nothing to accumulate")

// Resumed after a 15-minute pause: elapsed excludes the pause. `pausedAt` stays
// set (it is history), but because the state is ACTIVE it no longer accrues.
const resumed = s({ state: "ACTIVE", startedAt: T0, pausedMs: 15 * MIN, pausedAt: at(5 * MIN) })
assert.equal(elapsedMs(resumed, at(25 * MIN)), 10 * MIN, "25m wall clock − 15m paused = 10m")

// Multiple pause cycles accumulate.
const twicePaused = s({ state: "ACTIVE", startedAt: T0, pausedMs: 3 * MIN })
assert.equal(elapsedMs(twicePaused, at(10 * MIN)), 7 * MIN)

// Elapsed never goes negative, even with nonsense data (clock moved backwards).
assert.equal(elapsedMs(s({ state: "ACTIVE", startedAt: at(10 * MIN) }), T0), 0)
assert.equal(elapsedMs(s({ state: "ACTIVE", startedAt: T0, pausedMs: 999 * MIN }), at(MIN)), 0)

// ── Client clock manipulation cannot change the displayed time ──────────────
// A device 3 hours fast still renders the true elapsed time once skew-corrected.
const serverNow = at(10 * MIN)
const lyingClientNow = new Date(serverNow.getTime() + 3 * 60 * MIN)
const skew = clockSkewMs(serverNow, lyingClientNow)
assert.equal(skew, 3 * 60 * MIN)
assert.equal(skewCorrectedNow(lyingClientNow, skew).getTime(), serverNow.getTime())
assert.equal(elapsedMs(active, skewCorrectedNow(lyingClientNow, skew)), 10 * MIN)
// A device running slow is corrected the same way.
const slowClient = new Date(serverNow.getTime() - 42 * MIN)
assert.equal(
  elapsedMs(active, skewCorrectedNow(slowClient, clockSkewMs(serverNow, slowClient))),
  10 * MIN,
)

// ── Start is idempotent; competing starts do not double-start ───────────────
assert.equal(decideStart(blank, input()), "apply")
// Second click, a retry after a dropped response, or a duplicate tab.
assert.equal(decideStart(active, input()), "noop", "starting an active session must be a no-op")
// A different maintainer racing to start also gets a no-op rather than a restart —
// the timer is never reset.
assert.equal(decideStart(active, input({ actorId: OTHER })), "noop")
// You cannot "start" something that needs resuming, or that is already finished.
assert.equal(decideStart(paused, input()), "conflict")
assert.equal(decideStart(done, input()), "conflict")
assert.equal(decideStart(s({ state: "ABORTED" }), input()), "conflict")

// ── Stale UI loses ──────────────────────────────────────────────────────────
// A click queued against version 0 when the server is on version 4.
assert.equal(decideStart(s({ version: 4 }), input({ expectedVersion: 0 })), "conflict")
assert.equal(decideStart(s({ version: 4 }), input({ expectedVersion: 4 })), "apply")
// Omitting the version skips the check (server-internal callers).
assert.equal(decideStart(s({ version: 4 }), input()), "apply")

// ── Finish is idempotent; ending twice is not an error ─────────────────────
const mine = { controllerId: ME, controlExpiresAt: at(11 * MIN) }
assert.equal(decideFinish(s({ state: "ACTIVE", ...mine }), input()), "apply")
assert.equal(decideFinish(done, input()), "noop", "ending an ended session must be a no-op")
assert.equal(decideFinish(blank, input()), "conflict", "nothing to finish")
assert.equal(decideFinish(s({ state: "ABORTED" }), input()), "conflict")
// A paused session can be finished directly.
assert.equal(decideFinish(s({ state: "PAUSED", pausedAt: at(MIN), ...mine }), input()), "apply")

// ── controllerId records who is driving; it does NOT gate who may ──────────
//
// It used to be a lease: whoever started the session owned it, and everyone else
// was refused until it lapsed or they pressed "Take control". One person marks
// while the panel deliberates off the site, so that button was ceremony -- and
// the lease behind it could lock out the very person trying to finish. The gate
// is gone; the column is still written, so "who ran this" is still answerable.
const heldByOther = s({
  state: "ACTIVE",
  controllerId: OTHER,
  controlExpiresAt: at(11 * MIN), // lease still live
})
assert.equal(
  decideFinish(heldByOther, input()),
  "apply",
  "a live lease held by someone else must NOT block finishing",
)
assert.equal(decidePause(heldByOther, input()), "apply")
assert.equal(
  decideResume({ ...heldByOther, state: "PAUSED", pausedAt: at(MIN) }, input()),
  "apply",
)
// The holder themselves is obviously still fine.
assert.equal(decideFinish(heldByOther, input({ actorId: OTHER })), "apply")
// An abandoned session needs no recovery step any more: anyone permitted closes it.
const lapsed = s({ state: "ACTIVE", controllerId: OTHER, controlExpiresAt: at(9 * MIN) })
assert.equal(decideFinish(lapsed, input()), "apply")

// Concurrency is still guarded -- by the version, which is what actually stops a
// stale tab from overwriting newer state.
assert.equal(
  decideFinish(s({ state: "ACTIVE", version: 4 }), input({ expectedVersion: 2 })),
  "conflict",
  "a stale click must still lose",
)
assert.equal(nextControlExpiry(T0).getTime(), T0.getTime() + CONTROL_LEASE_MS)

// ── Pause / resume ─────────────────────────────────────────────────────────
assert.equal(decidePause(s({ state: "ACTIVE", ...mine }), input()), "apply")
assert.equal(decidePause(s({ state: "PAUSED", pausedAt: at(MIN) }), input()), "noop")
assert.equal(decidePause(blank, input()), "conflict", "cannot pause an unstarted session")
assert.equal(decidePause(done, input()), "conflict")
assert.equal(decideResume(s({ state: "PAUSED", pausedAt: at(MIN), ...mine }), input()), "apply")
assert.equal(decideResume(s({ state: "ACTIVE" }), input()), "noop")
assert.equal(decideResume(blank, input()), "conflict")

// ── Abort ──────────────────────────────────────────────────────────────────
assert.equal(decideAbort(s({ state: "ACTIVE" }), input()), "apply")
assert.equal(decideAbort(blank, input()), "apply", "an unstarted session can be abandoned")
assert.equal(decideAbort(s({ state: "ABORTED" }), input()), "noop")
assert.equal(decideAbort(done, input()), "conflict", "a completed session is reopened, not aborted")

// ── Reopen creates a new attempt rather than mutating history ──────────────
assert.equal(decideReopen(done), "apply")
assert.equal(decideReopen(s({ state: "ABORTED" })), "apply")
assert.equal(decideReopen(s({ state: "ACTIVE" })), "noop", "nothing to reopen while still live")
assert.equal(decideReopen(blank), "noop")

// ── Staleness is reported, never silently acted on ─────────────────────────
const quiet = s({ state: "ACTIVE", startedAt: T0, lastActivityAt: T0 })
assert.equal(isStale(quiet, at(STALE_AFTER_MS - SEC)), false)
assert.equal(isStale(quiet, at(STALE_AFTER_MS + SEC)), true)
// Falls back to startedAt when nothing has been recorded yet.
assert.equal(isStale(s({ state: "ACTIVE", startedAt: T0 }), at(STALE_AFTER_MS + SEC)), true)
// Finished sessions are never "stale".
assert.equal(isStale(done, at(999 * MIN)), false)
assert.equal(isStale(blank, at(999 * MIN)), false, "an unstarted session is not stale")
// A paused session can still go stale (someone paused and walked away).
assert.equal(isStale(s({ state: "PAUSED", startedAt: T0, pausedAt: T0, lastActivityAt: T0 }), at(30 * MIN)), true)

// displayState surfaces STALE without changing the stored state.
assert.equal(displayState(quiet, at(MIN)), "ACTIVE")
assert.equal(displayState(quiet, at(30 * MIN)), "STALE")
assert.equal(displayState(done, at(999 * MIN)), "COMPLETED")
assert.equal(displayState(blank, at(999 * MIN)), "NOT_STARTED")

// ── Every state is handled by every decision function ─────────────────────
const STATES: SessionStateName[] = ["NOT_STARTED", "ACTIVE", "PAUSED", "COMPLETED", "ABORTED"]
const DECIDERS = [decideStart, decidePause, decideResume, decideFinish, decideAbort]
for (const state of STATES) {
  const snap = s({ state, startedAt: state === "NOT_STARTED" ? null : T0, pausedAt: state === "PAUSED" ? T0 : null })
  for (const decide of DECIDERS) {
    const out = decide(snap, input())
    assert.ok(
      ["apply", "noop", "conflict"].includes(out),
      `${decide.name}(${state}) returned ${out}`,
    )
  }
}

// ── Display formatting ────────────────────────────────────────────────────
assert.equal(formatElapsed(0), "00:00")
assert.equal(formatElapsed(9 * SEC), "00:09")
assert.equal(formatElapsed(90 * SEC), "01:30")
assert.equal(formatElapsed(10 * MIN), "10:00")
assert.equal(formatElapsed(59 * MIN + 59 * SEC), "59:59")
assert.equal(formatElapsed(60 * MIN), "1:00:00")
assert.equal(formatElapsed(2 * 60 * MIN + 5 * MIN + 7 * SEC), "2:05:07")

console.log("recruitment session checks passed (timers, idempotency, control, staleness)")
