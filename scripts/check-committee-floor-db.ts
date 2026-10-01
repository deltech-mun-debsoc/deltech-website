// DB-backed checks for the committee floor:
//   COMMITTEE_DB_CHECKS=1 DATABASE_URL=... npx tsx scripts/check-committee-floor-db.ts
//
// check-committee-floor.ts proves the rules. This proves the database enforces
// what the floor code assumes it will: a ballot racing a close is either counted
// or refused, never stored and uncounted; a delegation votes once; a chair on a
// stale screen changes nothing; the mic only goes to a seat someone holds.
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
    // Seats 28 and 29 are left empty: they count for nothing.
    for (let i = 0; i < N; i++) {
      const p = await prisma.portfolio.create({ data: { committeeId: committee.id, name: `Seat ${i}` } })
      seats.push({ id: p.id, name: p.name })
      if (i >= 28) continue
      const d = await prisma.delegate.create({
        data: { eventId: event.id, fullName: `D${i}`, email: `d${i}.${tag}@x.io`, whatsapp: "1", institution: "X" },
      })
      await prisma.allotment.create({ data: { delegateId: d.id, committeeId: committee.id, portfolioId: p.id, allottedBy: "check" } })
    }
    const session = await prisma.committeeSession.create({
      data: { committeeId: committee.id, state: "ACTIVE", startedAt: new Date() },
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

    const micOf = async () => (await prisma.committeeSession.findUniqueOrThrow({ where: { id: session.id } })).micPortfolioId

    // ── A stale chair screen changes nothing ────────────────────────────────
    const v0 = await version()
    await daisOk({ op: "giveMic", portfolioId: seats[0].id })
    const stale = await runDaisOp(dais, committee.id, v0, { op: "giveMic", portfolioId: seats[1].id })
    assert.ok(!stale.success && stale.stale, "a stale version is refused")
    assert.equal(await micOf(), seats[0].id)
    // Two chairs acting at once from the same screen: exactly one applies.
    const vNow = await version()
    const both = await Promise.all([
      runDaisOp(dais, committee.id, vNow, { op: "giveMic", portfolioId: seats[2].id }),
      runDaisOp(dais, committee.id, vNow, { op: "giveMic", portfolioId: seats[3].id }),
    ])
    assert.equal(both.filter((r) => r.success).length, 1, "concurrent chairs: one wins, one is told it is stale")
    assert.equal(await version(), vNow + 1)
    // A refused operation must not consume the version (it rolls back with the transaction).
    const vBefore = await version()
    assert.equal((await runDaisOp(dais, committee.id, vBefore, { op: "giveMic", portfolioId: seats[29].id })).success, false,
      "the mic never goes to an empty seat")
    assert.equal(await version(), vBefore, "a failed dais operation rolls back its version bump")
    assert.equal((await runDaisOp(dais, committee.id, vBefore, { op: "giveMic", portfolioId: "not-a-seat" })).success, false)

    // ── The mic is one seat, seen by everyone ───────────────────────────────
    await daisOk({ op: "giveMic", portfolioId: seats[4].id })
    assert.deepEqual((await readFloor(del(7), committee.id)).mic, { portfolioId: seats[4].id, name: seats[4].name })
    await daisOk({ op: "takeMic" })
    assert.equal((await readFloor(del(7), committee.id)).mic, null)
    assert.equal((await runDelegateOp(del(5), committee.id, { op: "castBallot", voteId: "nope", choice: "YES" })).success, false,
      "a ballot for a vote that does not exist is refused")

    // ── A procedural vote: no abstaining, one ballot each, hidden count ─────
    await daisOk({ op: "openVote", subject: "Motion for a moderated caucus", kind: "PROCEDURAL", majority: "SIMPLE" })
    const proc = await prisma.vote.findFirstOrThrow({ where: { sessionId: session.id, state: "OPEN" } })
    assert.equal(proc.eligible, 28, "the denominator is the seated delegations")
    assert.equal((await runDaisOp(dais, committee.id, await version(), { op: "openVote", subject: "x", kind: "PROCEDURAL", majority: "SIMPLE" })).success,
      false, "one open vote at a time")
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
    assert.equal((await readFloor(dais, committee.id)).vote?.yes, 14, "the dais sees the count as it runs")
    await daisOk({ op: "closeVote", voteId: proc.id })
    assert.equal((await prisma.vote.findUniqueOrThrow({ where: { id: proc.id } })).passed, true, "14-6 passes")

    // ── A substantive vote: anyone may abstain ──────────────────────────────
    await daisOk({ op: "openVote", subject: "DR 1.1", kind: "SUBSTANTIVE", majority: "TWO_THIRDS" })
    const sub = await prisma.vote.findFirstOrThrow({ where: { sessionId: session.id, state: "OPEN" } })
    assert.ok((await runDelegateOp(del(1), committee.id, { op: "castBallot", voteId: sub.id, choice: "ABSTAIN" })).success)
    assert.ok((await runDelegateOp(del(12), committee.id, { op: "castBallot", voteId: sub.id, choice: "ABSTAIN" })).success)
    await daisOk({ op: "closeVote", voteId: sub.id })
    assert.equal((await prisma.vote.findUniqueOrThrow({ where: { id: sub.id } })).passed, false, "abstentions alone do not pass anything")

    // ── The race: ballots against a closing vote ────────────────────────────
    // Every round, 25 delegations vote at once while the chair closes
    // partway through. Whatever interleaving happens, the ballots stored must be
    // exactly the ballots counted.
    let refusedAfterClose = 0
    const ROUNDS = 20
    for (let round = 0; round < ROUNDS; round++) {
      await daisOk({ op: "openVote", subject: `Race ${round}`, kind: "SUBSTANTIVE", majority: "SIMPLE" })
      const vote = await prisma.vote.findFirstOrThrow({ where: { sessionId: session.id, state: "OPEN" } })
      // Odd rounds start the close before any ballot, even rounds after them, so
      // both orders of arrival are exercised rather than whichever one is faster.
      const v = await version()
      const startClose = () => runDaisOp(dais, committee.id, v, { op: "closeVote", voteId: vote.id })
      const early = round % 2 === 1 ? startClose() : null
      const ballots = Array.from({ length: 25 }, (_, i) =>
        runDelegateOp(del(i), committee.id, { op: "castBallot", voteId: vote.id, choice: i % 3 === 0 ? "NO" : "YES" }),
      )
      const close = early ?? (async () => {
        await new Promise((r) => setTimeout(r, round % 5))
        return startClose()
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
      `committee floor DB checks passed (stale and concurrent chairs, rollback, the mic, procedural and substantive votes, ` +
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
