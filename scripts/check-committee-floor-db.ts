// DB-backed checks for the committee floor:
//   COMMITTEE_DB_CHECKS=1 DATABASE_URL=... npx tsx scripts/check-committee-floor-db.ts
//
// check-committee-floor.ts proves the rules. This proves the database enforces
// what the floor code assumes it will: a ballot racing a close is either counted
// or refused, never stored and uncounted; a delegation votes once; a chair on a
// stale screen changes nothing; a delegation holds one place per list.
//
// Opt-in, and refuses to run against production or staging.
import assert from "node:assert"

if (process.env.COMMITTEE_DB_CHECKS !== "1") {
  console.log("committee floor DB checks skipped (set COMMITTEE_DB_CHECKS=1 to run)")
  process.exit(0)
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`
  assert.ok(!/^mun_(prod|staging)$/.test(db), `refusing to write test data into ${db}`)

  const { runDaisOp, runDelegateOp, readFloor } = await import("../src/lib/committee/floor-server")
  type ChatViewer = import("../src/lib/committee/chat").ChatViewer

  const tag = `cfdb${Date.now()}`
  const event = await prisma.event.create({ data: { name: tag, slug: tag, state: "ARCHIVED" } })
  try {
    const committee = await prisma.committee.create({ data: { eventId: event.id, name: tag, slug: tag, format: "ONLINE" } })
    const N = 30
    const seats: { id: string; name: string }[] = []
    for (let i = 0; i < N; i++) {
      const p = await prisma.portfolio.create({ data: { committeeId: committee.id, name: `Seat ${i}` } })
      const d = await prisma.delegate.create({
        data: { eventId: event.id, fullName: `D${i}`, email: `d${i}.${tag}@x.io`, whatsapp: "1", institution: "X" },
      })
      await prisma.allotment.create({ data: { delegateId: d.id, committeeId: committee.id, portfolioId: p.id, allottedBy: "check" } })
      seats.push({ id: p.id, name: p.name })
    }
    const session = await prisma.committeeSession.create({
      data: { committeeId: committee.id, state: "ACTIVE", startedAt: new Date() },
    })
    // Seats 0-9 PRESENT (may abstain), 10-24 PRESENT_AND_VOTING, 25-29 ABSENT.
    await prisma.sessionAttendance.createMany({
      data: seats.map((s, i) => ({
        sessionId: session.id,
        portfolioId: s.id,
        status: i < 10 ? ("PRESENT" as const) : i < 25 ? ("PRESENT_AND_VOTING" as const) : ("ABSENT" as const),
      })),
    })

    const dais: ChatViewer = { kind: "dais", userId: `${tag}-dais`, email: "chair@x.io" }
    const del = (i: number): ChatViewer => ({
      kind: "delegate", userId: `${tag}-u${i}`, email: `d${i}@x.io`, portfolioId: seats[i].id, portfolioName: seats[i].name,
    })
    const version = async () => (await prisma.committeeSession.findUniqueOrThrow({ where: { id: session.id } })).version
    const daisOk = async (op: Parameters<typeof runDaisOp>[3]) => {
      const r = await runDaisOp(dais, committee.id, await version(), op)
      assert.ok(r.success, `${op.op}: ${r.success ? "" : r.error}`)
    }

    // ── A stale chair screen changes nothing ────────────────────────────────
    const v0 = await version()
    await daisOk({ op: "setGslTime", seconds: 60 })
    const stale = await runDaisOp(dais, committee.id, v0, { op: "setGslTime", seconds: 120 })
    assert.ok(!stale.success && stale.stale, "a stale version is refused")
    assert.equal((await prisma.committeeSession.findUniqueOrThrow({ where: { id: session.id } })).gslSpeakingSeconds, 60)
    // Two chairs acting at once from the same screen: exactly one applies.
    const vNow = await version()
    const both = await Promise.all([
      runDaisOp(dais, committee.id, vNow, { op: "setGslTime", seconds: 45 }),
      runDaisOp(dais, committee.id, vNow, { op: "setGslTime", seconds: 75 }),
    ])
    assert.equal(both.filter((r) => r.success).length, 1, "concurrent chairs: one wins, one is told it is stale")
    assert.equal(await version(), vNow + 1)
    // A refused operation must not consume the version (it rolls back with the transaction).
    const vBefore = await version()
    assert.equal((await runDaisOp(dais, committee.id, vBefore, { op: "removeSpeaker", entryId: "nope" })).success, false)
    assert.equal(await version(), vBefore, "a failed dais operation rolls back its version bump")

    // ── One live place per delegation per list, even when racing ────────────
    const dup = await Promise.all([1, 2, 3, 4].map(() => runDelegateOp(del(0), committee.id, { op: "requestToSpeak", motionId: null })))
    assert.equal(dup.filter((r) => r.success).length, 1, "four simultaneous requests queue once")
    assert.equal((await runDelegateOp(del(26), committee.id, { op: "requestToSpeak", motionId: null })).success, false,
      "an absent delegation cannot join the list")
    await daisOk({ op: "addSpeaker", portfolioId: seats[1].id, motionId: null })
    await daisOk({ op: "nextSpeaker", motionId: null })
    let floor = await readFloor(dais, committee.id)
    assert.equal(floor.gsl.find((s) => s.state === "SPEAKING")?.portfolioId, seats[0].id, "first in, first to speak")
    assert.equal(floor.gsl.find((s) => s.state === "SPEAKING")?.clock.allottedSeconds, 45, "time fixed when they start")
    await daisOk({ op: "nextSpeaker", motionId: null })
    // Having spoken, seat 0 may queue again: the live key was released.
    assert.ok((await runDelegateOp(del(0), committee.id, { op: "requestToSpeak", motionId: null })).success)

    // ── Motion to a caucus, through a procedural vote ───────────────────────
    const proposed = await runDelegateOp(del(2), committee.id, {
      op: "proposeMotion",
      draft: { kind: "MODERATED_CAUCUS", topic: "Finance", totalSeconds: 600, speakingSeconds: 60 },
    })
    assert.ok(proposed.success)
    const motion = await prisma.motion.findFirstOrThrow({ where: { sessionId: session.id, proposedByPortfolioId: seats[2].id } })
    await daisOk({ op: "putToVote", motionId: motion.id })
    const proc = await prisma.vote.findFirstOrThrow({ where: { motionId: motion.id } })
    assert.equal(proc.eligible, 25, "the denominator is the present delegations")
    assert.equal((await runDelegateOp(del(3), committee.id, { op: "castBallot", voteId: proc.id, choice: "ABSTAIN" })).success, false,
      "no abstaining on a procedural vote")
    for (let i = 0; i < 14; i++) assert.ok((await runDelegateOp(del(i), committee.id, { op: "castBallot", voteId: proc.id, choice: "YES" })).success)
    for (let i = 14; i < 20; i++) assert.ok((await runDelegateOp(del(i), committee.id, { op: "castBallot", voteId: proc.id, choice: "NO" })).success)
    assert.equal((await runDelegateOp(del(0), committee.id, { op: "castBallot", voteId: proc.id, choice: "NO" })).success, false,
      "a delegation votes once")
    const delegateView = await readFloor(del(5), committee.id)
    assert.equal(delegateView.vote?.yes, null, "a delegate does not see the running count")
    assert.equal(delegateView.vote?.myChoice, "YES", "but does see its own ballot")
    assert.equal(delegateView.vote?.ballots, null, "nor anyone else's")
    await daisOk({ op: "closeVote", voteId: proc.id })
    assert.equal((await prisma.motion.findUniqueOrThrow({ where: { id: motion.id } })).state, "PASSED", "14-6 passes")
    await daisOk({ op: "startCaucus", motionId: motion.id })
    assert.ok((await runDelegateOp(del(4), committee.id, { op: "requestToSpeak", motionId: motion.id })).success,
      "the caucus has its own list")
    await daisOk({ op: "endCaucus", motionId: motion.id })
    assert.equal(await prisma.speakerEntry.count({ where: { motionId: motion.id, state: "QUEUED" } }), 0, "ending a caucus clears its queue")

    // ── Abstention follows attendance on a substantive vote ────────────────
    await daisOk({ op: "openVote", subject: "DR 1.1", majority: "TWO_THIRDS" })
    const sub = await prisma.vote.findFirstOrThrow({ where: { sessionId: session.id, state: "OPEN" } })
    assert.ok((await runDelegateOp(del(1), committee.id, { op: "castBallot", voteId: sub.id, choice: "ABSTAIN" })).success, "present may abstain")
    assert.equal((await runDelegateOp(del(12), committee.id, { op: "castBallot", voteId: sub.id, choice: "ABSTAIN" })).success, false,
      "present and voting may not")
    assert.equal((await runDelegateOp(del(27), committee.id, { op: "castBallot", voteId: sub.id, choice: "YES" })).success, false,
      "absent may not vote at all")
    await daisOk({ op: "closeVote", voteId: sub.id })

    // ── The race: ballots against a closing vote ────────────────────────────
    // Every round, 25 present delegations vote at once while the chair closes
    // partway through. Whatever interleaving happens, the ballots stored must be
    // exactly the ballots counted.
    let refusedAfterClose = 0
    const ROUNDS = 20
    for (let round = 0; round < ROUNDS; round++) {
      await daisOk({ op: "openVote", subject: `Race ${round}`, majority: "SIMPLE" })
      const vote = await prisma.vote.findFirstOrThrow({ where: { sessionId: session.id, state: "OPEN" } })
      const ballots = Array.from({ length: 25 }, (_, i) =>
        runDelegateOp(del(i), committee.id, { op: "castBallot", voteId: vote.id, choice: i % 3 === 0 ? "NO" : "YES" }),
      )
      const close = (async () => {
        await new Promise((r) => setTimeout(r, round % 5))
        return runDaisOp(dais, committee.id, await version(), { op: "closeVote", voteId: vote.id })
      })()
      const [results, closed] = await Promise.all([Promise.all(ballots), close])
      assert.ok(closed.success, `round ${round}: close failed: ${closed.success ? "" : closed.error}`)
      const after = await prisma.vote.findUniqueOrThrow({ where: { id: vote.id } })
      const stored = await prisma.voteBallot.count({ where: { voteId: vote.id } })
      const accepted = results.filter((r) => r.success).length
      assert.equal(after.yes + after.no + after.abstain, stored, `round ${round}: stored ${stored}, counted ${after.yes + after.no + after.abstain}`)
      assert.equal(accepted, stored, `round ${round}: every accepted ballot is stored`)
      refusedAfterClose += results.length - accepted
    }

    console.log(
      `committee floor DB checks passed (stale and concurrent chairs, rollback, list races, motion to caucus, abstention, ` +
        `${ROUNDS} ballot-vs-close races with ${refusedAfterClose} ballots correctly refused after close)`,
    )
  } finally {
    // Everything hangs off the event through cascades, apart from the rows that
    // reference portfolios and delegates.
    const committees = (await prisma.committee.findMany({ where: { eventId: event.id }, select: { id: true } })).map((c) => c.id)
    await prisma.committeeSession.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.allotment.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.portfolio.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.delegate.deleteMany({ where: { eventId: event.id } })
    await prisma.committee.deleteMany({ where: { eventId: event.id } })
    await prisma.event.delete({ where: { id: event.id } })
    await prisma.auditLog.deleteMany({ where: { actorEmail: "chair@x.io" } })
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
