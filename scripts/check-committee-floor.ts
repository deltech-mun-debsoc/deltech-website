// Runnable check for the committee floor:
//   npx tsx scripts/check-committee-floor.ts
//
// Vote outcomes and ballot eligibility decide whether a committee's decision is
// valid, so they are swept exhaustively rather than sampled.
import assert from "node:assert"
import {
  CAUCUS_SECONDS,
  SPEAKING_SECONDS,
  decideBallot,
  decideMotion,
  elapsedClockMs,
  endClock,
  liveKey,
  nextInLine,
  parseDaisOp,
  parseDelegateOp,
  parseMotionDraft,
  pauseClock,
  remainingMs,
  resumeClock,
  tallyBallots,
  votePasses,
  type Clock,
  type MotionKindName,
  type MotionStateName,
} from "../src/lib/committee/floor"
import type { CommitteeAttendanceName } from "../src/lib/committee/roll-call"

const t = (s: number) => new Date(1_000_000 + s * 1000)

// ── Clocks ──────────────────────────────────────────────────────────────────
const fresh: Clock = { allottedSeconds: 90, startedAt: null, pausedAt: null, pausedMs: 0, endedAt: null }
assert.equal(remainingMs(fresh, t(50)), 90_000, "an unstarted clock has its full time")
const running = { ...fresh, startedAt: t(0) }
assert.equal(remainingMs(running, t(30)), 60_000)
assert.equal(remainingMs(running, t(100)), -10_000, "overtime is negative, so the chair sees how far over")
const paused = { ...running, ...pauseClock(running, t(30))! }
assert.equal(remainingMs(paused, t(500)), 60_000, "a paused clock does not run")
const resumed = { ...paused, ...resumeClock(paused, t(40))! }
assert.equal(resumed.pausedMs, 10_000)
assert.equal(remainingMs(resumed, t(50)), 50_000, "90 - (50 - 0 - 10)")
const endedWhilePaused = { ...paused, ...endClock(paused, t(70))! }
assert.equal(endedWhilePaused.pausedMs, 40_000, "an open pause is folded in when the clock ends")
assert.equal(elapsedClockMs(endedWhilePaused, t(9999)), 30_000, "an ended clock is frozen")
assert.equal(pauseClock(fresh, t(1)), null, "cannot pause what has not started")
assert.equal(pauseClock(paused, t(31)), null, "cannot pause twice")
assert.equal(resumeClock(running, t(1)), null, "cannot resume what is not paused")
assert.equal(endClock(endedWhilePaused, t(80)), null, "cannot end twice")
assert.equal(pauseClock(endedWhilePaused, t(80)), null)
// A server clock behind a client's must not produce negative elapsed time.
assert.equal(elapsedClockMs({ ...running, startedAt: t(10) }, t(5)), 0)

// ── Speakers lists ──────────────────────────────────────────────────────────
assert.notEqual(liveKey("s", null, "p"), liveKey("s", "m1", "p"), "the GSL and a caucus are separate lists")
assert.notEqual(liveKey("s1", null, "p"), liveKey("s2", null, "p"), "and so are sessions")
assert.equal(
  nextInLine([
    { id: "a", position: 3, state: "QUEUED" as const },
    { id: "b", position: 1, state: "SPOKEN" as const },
    { id: "c", position: 2, state: "QUEUED" as const },
    { id: "d", position: 0, state: "REMOVED" as const },
  ])?.id,
  "c",
  "next is the lowest queued position, skipping spoken and removed",
)
assert.equal(nextInLine([{ id: "a", position: 1, state: "SPEAKING" as const }]), null)

// ── Motions ─────────────────────────────────────────────────────────────────
const states: MotionStateName[] = ["PROPOSED", "VOTING", "PASSED", "FAILED", "WITHDRAWN", "RULED_OUT", "IN_PROGRESS", "ENDED"]
const kinds: MotionKindName[] = ["MODERATED_CAUCUS", "UNMODERATED_CAUCUS", "EXTEND", "CLOSE_DEBATE", "OTHER"]
for (const kind of kinds) {
  for (const state of states) {
    const m = { state, kind }
    assert.equal(decideMotion(m, "withdraw"), state === "PROPOSED" ? "WITHDRAWN" : null)
    assert.equal(decideMotion(m, "putToVote"), state === "PROPOSED" ? "VOTING" : null, "only a proposed motion goes to a vote, once")
    assert.equal(decideMotion(m, "pass"), state === "VOTING" ? "PASSED" : null)
    assert.equal(decideMotion(m, "fail"), state === "VOTING" ? "FAILED" : null)
    const caucus = kind === "MODERATED_CAUCUS" || kind === "UNMODERATED_CAUCUS"
    assert.equal(decideMotion(m, "start"), state === "PASSED" && caucus ? "IN_PROGRESS" : null, "only a passed caucus starts")
    assert.equal(decideMotion(m, "end"), state === "IN_PROGRESS" ? "ENDED" : null)
  }
}

const mod = { kind: "MODERATED_CAUCUS", topic: "Climate finance", totalSeconds: 600, speakingSeconds: 60 }
assert.deepEqual(parseMotionDraft(mod), mod)
assert.equal(parseMotionDraft({ ...mod, speakingSeconds: 900 }), null, "speaking time longer than the caucus is refused")
assert.equal(parseMotionDraft({ ...mod, topic: "  " }), null)
assert.equal(parseMotionDraft({ ...mod, totalSeconds: CAUCUS_SECONDS.max + 1 }), null)
assert.equal(parseMotionDraft({ ...mod, speakingSeconds: SPEAKING_SECONDS.min - 1 }), null)
assert.equal(parseMotionDraft({ ...mod, totalSeconds: 600.5 }), null, "no fractional seconds")
assert.equal(parseMotionDraft({ ...mod, totalSeconds: "600" }), null, "no strings where numbers belong")
assert.equal(parseMotionDraft({ ...mod, topic: "a‮b" })!.topic, "a b", "bidi overrides do not reach the room")
assert.deepEqual(parseMotionDraft({ kind: "UNMODERATED_CAUCUS", totalSeconds: 300, topic: "ignored" }), {
  kind: "UNMODERATED_CAUCUS", topic: null, totalSeconds: 300, speakingSeconds: null,
}, "fields a kind does not use are dropped, not stored")
assert.deepEqual(parseMotionDraft({ kind: "CLOSE_DEBATE" }), { kind: "CLOSE_DEBATE", topic: null, totalSeconds: null, speakingSeconds: null })
assert.equal(parseMotionDraft({ kind: "UNMODERATED_CAUCUS" }), null)
assert.equal(parseMotionDraft({ kind: "SUSPEND" }), null, "unknown kinds are refused")

// ── Ballots: every attendance state against every choice ────────────────────
const present: CommitteeAttendanceName[] = ["PRESENT", "PRESENT_AND_VOTING", "LATE"]
for (const att of [null, "EXPECTED", "ABSENT", ...present] as (CommitteeAttendanceName | null)[]) {
  for (const kind of ["PROCEDURAL", "SUBSTANTIVE"] as const) {
    for (const choice of ["YES", "NO", "ABSTAIN"] as const) {
      const d = decideBallot(kind, att, choice)
      const inRoom = att !== null && present.includes(att)
      let expected: string
      if (!inRoom) expected = "not-present"
      else if (choice !== "ABSTAIN") expected = "ok"
      else if (kind === "PROCEDURAL") expected = "no-abstain-procedural"
      else if (att === "PRESENT_AND_VOTING") expected = "no-abstain-voting"
      else expected = "ok"
      assert.equal(d.ok ? "ok" : d.reason, expected, `${att}/${kind}/${choice}`)
    }
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
assert.deepEqual(parseDaisOp({ op: "addSpeaker", portfolioId: "p1" }), { op: "addSpeaker", portfolioId: "p1", motionId: null })
assert.deepEqual(parseDaisOp({ op: "nextSpeaker", motionId: "m1" }), { op: "nextSpeaker", motionId: "m1" })
assert.equal(parseDaisOp({ op: "addSpeaker", portfolioId: "p1", motionId: "bad id!" }), null, "a malformed optional id refuses, it does not become null")
assert.equal(parseDaisOp({ op: "addSpeaker", portfolioId: { in: ["p1"] } }), null, "no Prisma operators as ids")
assert.equal(parseDaisOp({ op: "setGslTime", seconds: 5 }), null)
assert.deepEqual(parseDaisOp({ op: "setGslTime", seconds: 60 }), { op: "setGslTime", seconds: 60 })
assert.deepEqual(parseDaisOp({ op: "openVote", subject: " Draft Resolution 1.1 ", majority: "TWO_THIRDS" }),
  { op: "openVote", subject: "Draft Resolution 1.1", majority: "TWO_THIRDS" })
assert.equal(parseDaisOp({ op: "openVote", subject: "DR", majority: "UNANIMOUS" }), null)
assert.equal(parseDaisOp({ op: "dropTable" }), null)
assert.equal(parseDaisOp(null), null)
assert.deepEqual(parseDelegateOp({ op: "castBallot", voteId: "v1", choice: "ABSTAIN" }), { op: "castBallot", voteId: "v1", choice: "ABSTAIN" })
assert.equal(parseDelegateOp({ op: "castBallot", voteId: "v1", choice: "MAYBE" }), null)
assert.equal(parseDelegateOp({ op: "closeVote", voteId: "v1" }), null, "a delegate cannot reach a dais operation")
assert.equal(parseDelegateOp({ op: "addSpeaker", portfolioId: "p2" }), null, "nor add someone else to a list")
assert.deepEqual(parseDelegateOp({ op: "requestToSpeak" }), { op: "requestToSpeak", motionId: null })

console.log("committee floor checks passed (clocks, speakers lists, motions, ballot eligibility, outcomes, parsing)")
