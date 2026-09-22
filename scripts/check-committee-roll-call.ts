// Runnable check for roll call and quorum:
//   npx tsx scripts/check-committee-roll-call.ts
//
// Quorum decides whether debate may open and whether a vote counts, so the
// arithmetic is pinned here rather than trusted to a comparison in a component.
import assert from "node:assert"
import {
  DEFAULT_QUORUM_FRACTION,
  hasQuorum,
  isPresent,
  mayAbstain,
  seatsShortOfQuorum,
  tally,
  votingStrength,
  type CommitteeAttendanceName,
} from "../src/lib/committee/roll-call"

const rows = (spec: Partial<Record<CommitteeAttendanceName, number>>): CommitteeAttendanceName[] => {
  const out: CommitteeAttendanceName[] = []
  for (const [k, n] of Object.entries(spec)) {
    for (let i = 0; i < (n ?? 0); i++) out.push(k as CommitteeAttendanceName)
  }
  return out
}

// ── Presence ────────────────────────────────────────────────────────────────
assert.ok(isPresent("PRESENT"))
assert.ok(isPresent("PRESENT_AND_VOTING"))
// LATE is in the room. Excluding it would let a chair lose quorum by marking
// arrivals honestly.
assert.ok(isPresent("LATE"), "LATE must count toward quorum")
assert.ok(!isPresent("ABSENT"))
assert.ok(!isPresent("EXPECTED"), "an uncalled seat is not present")

// ── Abstention ──────────────────────────────────────────────────────────────
// The entire reason PRESENT and PRESENT_AND_VOTING are separate states.
assert.ok(mayAbstain("PRESENT"))
assert.ok(mayAbstain("LATE"))
assert.ok(!mayAbstain("PRESENT_AND_VOTING"), "present and voting gives up abstention")

// ── Tally ───────────────────────────────────────────────────────────────────
const t = tally(rows({ PRESENT: 5, PRESENT_AND_VOTING: 3, ABSENT: 2, LATE: 1, EXPECTED: 4 }))
assert.equal(t.total, 15)
assert.equal(t.present, 5)
assert.equal(t.presentAndVoting, 3)
assert.equal(t.absent, 2)
assert.equal(t.late, 1)
assert.equal(t.expected, 4)
assert.equal(t.inRoom, 9, "5 present + 3 present-and-voting + 1 late")
assert.equal(votingStrength(t), 9)
assert.equal(tally([]).total, 0)

// ── Quorum: strictly greater than the fraction ──────────────────────────────
// 30 seats, one third = 10. Exactly 10 is NOT quorum.
const at = (total: number, inRoom: number) =>
  tally(rows({ PRESENT: inRoom, EXPECTED: total - inRoom }))

assert.ok(!hasQuorum(at(30, 10)), "exactly one third is not quorum")
assert.ok(hasQuorum(at(30, 11)), "one more than a third is quorum")
assert.ok(!hasQuorum(at(30, 0)))
assert.ok(hasQuorum(at(30, 30)))

// A non-integer threshold rounds the right way: 10 seats, one third = 3.33, so 4.
assert.ok(!hasQuorum(at(10, 3)))
assert.ok(hasQuorum(at(10, 4)))

// An empty committee never has quorum, and must not divide by zero.
assert.ok(!hasQuorum(tally([])))

// A caller-supplied fraction is honoured (a conference using a majority quorum).
assert.ok(!hasQuorum(at(10, 5), 0.5), "exactly half is not a majority")
assert.ok(hasQuorum(at(10, 6), 0.5))

// ── Countdown agrees with the predicate, always ─────────────────────────────
assert.equal(seatsShortOfQuorum(at(30, 11)), 0)
assert.equal(seatsShortOfQuorum(at(30, 10)), 1)
assert.equal(seatsShortOfQuorum(at(30, 0)), 11)

// The invariant that matters: the chair's countdown hits zero exactly when
// quorum is reached. A sweep, because these are two separate expressions and
// an off-by-one in either would be invisible in the UI until a vote was
// challenged.
for (const fraction of [1 / 3, 1 / 4, 0.5, 2 / 3]) {
  for (let total = 0; total <= 60; total++) {
    for (let inRoom = 0; inRoom <= total; inRoom++) {
      const snapshot = at(total, inRoom)
      assert.equal(
        seatsShortOfQuorum(snapshot, fraction) === 0,
        hasQuorum(snapshot, fraction),
        `countdown disagrees with quorum at total=${total} inRoom=${inRoom} f=${fraction}`,
      )
    }
  }
}

// And the countdown is a real distance: adding exactly that many seats reaches
// quorum, and one fewer does not.
for (const fraction of [1 / 3, 1 / 4, 0.5]) {
  for (let total = 1; total <= 40; total++) {
    for (let inRoom = 0; inRoom <= total; inRoom++) {
      const short = seatsShortOfQuorum(at(total, inRoom), fraction)
      if (short === 0 || inRoom + short > total) continue
      assert.ok(
        hasQuorum(at(total, inRoom + short), fraction),
        `adding ${short} seats should reach quorum at total=${total} inRoom=${inRoom}`,
      )
      assert.ok(
        !hasQuorum(at(total, inRoom + short - 1), fraction),
        `one short of the countdown must not be quorum at total=${total} inRoom=${inRoom}`,
      )
    }
  }
}

assert.equal(DEFAULT_QUORUM_FRACTION, 1 / 3)

console.log("committee roll call checks passed (presence, abstention, tally, quorum countdown)")
