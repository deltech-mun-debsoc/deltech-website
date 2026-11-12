// Runnable check for the committee floor:
//   npx tsx scripts/check-committee-floor.ts
//
// Vote outcomes and ballot eligibility decide whether a committee's decision is
// valid, so they are swept exhaustively rather than sampled.
import assert from "node:assert"
import {
  decideBallot,
  parseDaisOp,
  parseDelegateOp,
  tallyBallots,
  votePasses,
} from "../src/lib/committee/floor"

// ── Ballots: every kind against every choice ────────────────────────────────
for (const kind of ["PROCEDURAL", "SUBSTANTIVE"] as const) {
  for (const choice of ["YES", "NO", "ABSTAIN"] as const) {
    const d = decideBallot(kind, choice)
    const expected = choice === "ABSTAIN" && kind === "PROCEDURAL" ? "no-abstain-procedural" : "ok"
    assert.equal(d.ok ? "ok" : d.reason, expected, `${kind}/${choice}`)
  }
}

// ── Outcomes ────────────────────────────────────────────────────────────────
assert.equal(votePasses("SIMPLE", 10, 9), true)
assert.equal(votePasses("SIMPLE", 10, 10), false, "a tie fails")
assert.equal(votePasses("SIMPLE", 0, 0), false, "nobody voting yes or no is a failure, not a pass")
assert.equal(votePasses("TWO_THIRDS", 20, 10), true, "exactly two thirds passes")
assert.equal(votePasses("TWO_THIRDS", 19, 10), false)
assert.equal(votePasses("TWO_THIRDS", 0, 0), false)
// Abstentions never enter the calculation, so a flood of them cannot sink a vote.
// Sweep against the plain-arithmetic definitions.
for (let yes = 0; yes <= 45; yes++) {
  for (let no = 0; no + yes <= 45; no++) {
    const voting = yes + no
    assert.equal(votePasses("SIMPLE", yes, no), voting > 0 && yes > voting / 2, `simple ${yes}/${no}`)
    assert.equal(votePasses("TWO_THIRDS", yes, no), voting > 0 && yes >= (2 * voting) / 3, `two-thirds ${yes}/${no}`)
  }
}
assert.deepEqual(tallyBallots(["YES", "NO", "ABSTAIN", "YES"]), { yes: 2, no: 1, abstain: 1 })
assert.deepEqual(tallyBallots([]), { yes: 0, no: 0, abstain: 0 })

// ── Parsing at the door ─────────────────────────────────────────────────────
assert.deepEqual(parseDaisOp({ op: "giveMic", portfolioId: "p1" }), { op: "giveMic", portfolioId: "p1" })
assert.equal(parseDaisOp({ op: "giveMic", portfolioId: { in: ["p1"] } }), null, "no Prisma operators as ids")
assert.equal(parseDaisOp({ op: "giveMic" }), null, "the mic goes to someone, never to nobody by default")
assert.deepEqual(parseDaisOp({ op: "takeMic", portfolioId: "ignored" }), { op: "takeMic" })
assert.deepEqual(
  parseDaisOp({ op: "openVote", subject: " Draft Resolution 1.1 ", kind: "SUBSTANTIVE", majority: "TWO_THIRDS" }),
  { op: "openVote", subject: "Draft Resolution 1.1", kind: "SUBSTANTIVE", majority: "TWO_THIRDS" },
)
assert.equal(parseDaisOp({ op: "openVote", subject: "DR", kind: "SUBSTANTIVE", majority: "UNANIMOUS" }), null)
assert.equal(parseDaisOp({ op: "openVote", subject: "DR", majority: "SIMPLE" }), null, "the kind is never defaulted")
assert.equal(parseDaisOp({ op: "openVote", subject: "a‮b", kind: "PROCEDURAL", majority: "SIMPLE" })!.op, "openVote")
assert.equal(
  (parseDaisOp({ op: "openVote", subject: "a‮b", kind: "PROCEDURAL", majority: "SIMPLE" }) as { subject: string }).subject,
  "a b",
  "bidi overrides do not reach the room",
)
assert.equal(parseDaisOp({ op: "dropTable" }), null)
assert.equal(parseDaisOp(null), null)
assert.deepEqual(parseDelegateOp({ op: "castBallot", voteId: "v1", choice: "ABSTAIN" }), { op: "castBallot", voteId: "v1", choice: "ABSTAIN" })
assert.equal(parseDelegateOp({ op: "castBallot", voteId: "v1", choice: "MAYBE" }), null)
assert.equal(parseDelegateOp({ op: "closeVote", voteId: "v1" }), null, "a delegate cannot reach a dais operation")
assert.equal(parseDelegateOp({ op: "giveMic", portfolioId: "p2" }), null, "nor hand themselves the mic")

console.log("committee floor checks passed (ballot eligibility, outcomes, parsing)")
