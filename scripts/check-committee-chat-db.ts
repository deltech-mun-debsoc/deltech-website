// DB-backed checks for committee chat:
//   COMMITTEE_DB_CHECKS=1 DATABASE_URL=... npx tsx scripts/check-committee-chat-db.ts
//
// check-committee-chat.ts proves the rules; this proves the real server
// functions obey them against Postgres: what each viewer reads, catch-up after
// a cursor, blocks reaching screens that already showed a message, the rate
// limit, and two moderators racing.
//
// Opt-in because it needs a writable Postgres, and it refuses to run against
// production or staging even when pointed at them through a tunnel.
import assert from "node:assert"

if (process.env.COMMITTEE_DB_CHECKS !== "1") {
  console.log("committee chat DB checks skipped (set COMMITTEE_DB_CHECKS=1 to run)")
  process.exit(0)
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`
  // Both real databases are reached on 127.0.0.1 through an SSH tunnel, so the
  // host proves nothing. The database name does.
  assert.ok(!/^mun_(prod|staging)$/.test(db), `refusing to write test data into ${db}`)

  const { sendCommitteeMessage, readCommitteeMessages, moderateCommitteeMessage } = await import("../src/lib/committee/messages")
  const { canSee } = await import("../src/lib/committee/chat")
  type ChatViewer = import("../src/lib/committee/chat").ChatViewer

  const tag = `ccdb${Date.now()}`
  // ARCHIVED: only one open event may exist, and a scratch database seeded for
  // development already has one. Chat does not read event state.
  const event = await prisma.event.create({ data: { name: tag, slug: tag, state: "ARCHIVED" } })
  try {
  const mk = (slug: string) =>
    prisma.committee.create({ data: { eventId: event.id, name: slug, slug, format: "ONLINE" } })
  const c1 = await mk(`${tag}-unsc`)
  const c2 = await mk(`${tag}-disec`)

  async function seat(committeeId: string, name: string, allot = true) {
    const p = await prisma.portfolio.create({ data: { committeeId, name } })
    if (allot) {
      const d = await prisma.delegate.create({
        data: { eventId: event.id, fullName: name, email: `${name}.${tag}@x.io`, whatsapp: "1", institution: "X" },
      })
      await prisma.allotment.create({ data: { delegateId: d.id, committeeId, portfolioId: p.id, allottedBy: "check" } })
    }
    return p
  }
  const france = await seat(c1.id, "France")
  const india = await seat(c1.id, "India")
  const kenya = await seat(c1.id, "Kenya")
  const empty = await seat(c1.id, "Unallotted", false)
  const usa = await seat(c2.id, "USA")

  const dais: ChatViewer = { kind: "dais", userId: `${tag}-dais`, email: "chair@x.io" }
  const dais2: ChatViewer = { kind: "dais", userId: `${tag}-dais2`, email: "cochair@x.io" }
  const as = (p: { id: string; name: string }): ChatViewer => ({
    kind: "delegate", userId: `${tag}-${p.id}`, email: `${p.name}@x.io`, portfolioId: p.id, portfolioName: p.name,
  })
  const vFrance = as(france), vIndia = as(india), vKenya = as(kenya)

  const sent = async (v: ChatViewer, scope: "FLOOR" | "DM" | "EB", to: string | null, body: string) => {
    const r = await sendCommitteeMessage(v, c1.id, { scope, toPortfolioId: to, body })
    assert.ok(r.success, `${body}: ${r.success ? "" : r.error}`)
    return r.message.id
  }
  const floor1 = await sent(vFrance, "FLOOR", null, "floor1")
  await sent(vFrance, "DM", india.id, "dm france->india")
  await sent(vIndia, "DM", france.id, "dm india->france")
  await sent(vKenya, "EB", null, "kenya to dais")
  await sent(dais, "EB", kenya.id, "dais to kenya")
  await sent(dais, "FLOOR", null, "order")

  // Recipients outside the committee, unallotted seats and oneself are refused.
  for (const to of [usa.id, empty.id, france.id]) {
    const r = await sendCommitteeMessage(vFrance, c1.id, { scope: "DM", toPortfolioId: to, body: "x" })
    assert.equal(r.success, false, `DM to ${to} must be refused`)
  }

  await prisma.committee.update({ where: { id: c1.id }, data: { holdDirectMessages: true } })
  const held = await sent(vFrance, "DM", kenya.id, "held france->kenya")
  assert.equal((await prisma.committeeMessage.findUniqueOrThrow({ where: { id: held } })).state, "HELD")

  // ── Every viewer reads exactly what canSee allows, and nothing from c2 ─────
  const all = await prisma.committeeMessage.findMany({ where: { committeeId: c1.id } })
  const cursors = new Map<ChatViewer, { cursor: number; mod: string }>()
  for (const v of [dais, vFrance, vIndia, vKenya]) {
    const page = await readCommitteeMessages(v, c1.id, null, null)
    const expected = all.filter((m) => canSee(v, m)).map((m) => m.id).sort((a, b) => a - b)
    assert.deepEqual(page.messages.map((m) => m.id), expected, `${v.kind} ${v.kind === "delegate" ? v.portfolioName : ""} reads exactly what it may`)
    for (const m of page.messages) {
      assert.equal("authorEmail" in m, v.kind === "dais", "only the dais payload carries the author")
    }
    cursors.set(v, { cursor: page.cursor, mod: page.modCursor })
  }
  assert.ok(!(await readCommitteeMessages(vKenya, c1.id, null, null)).messages.some((m) => m.body === "held france->kenya"),
    "the recipient does not see a held DM")

  // ── Approval reaches the recipient through the moderation cursor ──────────
  assert.deepEqual(await moderateCommitteeMessage(dais, c1.id, held, "approve"), { success: true })
  {
    const k = cursors.get(vKenya)!
    const page = await readCommitteeMessages(vKenya, c1.id, k.cursor, k.mod)
    assert.ok(page.messages.some((m) => m.id === held && m.state === "SENT"), "approved DM reaches its recipient on catch-up")
  }

  // ── A block reaches every screen that already showed the message ──────────
  assert.deepEqual(await moderateCommitteeMessage(dais, c1.id, floor1, "block"), { success: true })
  for (const v of [vFrance, vIndia, vKenya]) {
    const c = cursors.get(v)!
    const page = await readCommitteeMessages(v, c1.id, c.cursor, c.mod)
    assert.ok(page.removed.includes(floor1), `${v.kind === "delegate" ? v.portfolioName : ""} is told to drop the blocked message`)
    assert.ok(!page.messages.some((m) => m.id === floor1))
  }
  const daisPage = await readCommitteeMessages(dais, c1.id, cursors.get(dais)!.cursor, cursors.get(dais)!.mod)
  assert.ok(daisPage.messages.some((m) => m.id === floor1 && m.state === "BLOCKED"), "the dais still sees it, marked removed")
  assert.deepEqual(await moderateCommitteeMessage(dais, c1.id, floor1, "restore"), { success: true })
  {
    const c = cursors.get(vIndia)!
    const page = await readCommitteeMessages(vIndia, c1.id, c.cursor, c.mod)
    assert.ok(page.messages.some((m) => m.id === floor1 && m.state === "SENT"), "a restored message comes back")
  }

  // A delegate cannot moderate, and a message id from another committee is not found.
  assert.equal((await moderateCommitteeMessage(vFrance, c1.id, floor1, "block")).success, false)
  const other = await sendCommitteeMessage(as(usa), c2.id, { scope: "FLOOR", toPortfolioId: null, body: "c2" })
  assert.ok(other.success)
  assert.equal((await moderateCommitteeMessage(dais, c1.id, other.message.id, "block")).success, false,
    "moderating through the wrong committee must not reach the message")

  // ── Two moderators racing on one held message: exactly one wins ───────────
  const race = await sent(vIndia, "DM", kenya.id, "race")
  const results = await Promise.all([
    moderateCommitteeMessage(dais, c1.id, race, "approve"),
    moderateCommitteeMessage(dais2, c1.id, race, "block"),
  ])
  // Both may apply, one after the other: approve, then block of the now-sent
  // message, is two legitimate actions. What must never happen is an action
  // applied against a state it did not read. So the audit trail and the final
  // state have to tell the same story.
  const log = (
    await prisma.auditLog.findMany({
      where: { entityId: String(race), action: { startsWith: "committee_message_" } },
      orderBy: { at: "asc" },
      select: { action: true },
    })
  ).map((a) => a.action.replace("committee_message_", ""))
  const final = (await prisma.committeeMessage.findUniqueOrThrow({ where: { id: race } })).state
  const story = `${log.join(",")} -> ${final} (results: ${JSON.stringify(results)})`
  assert.ok(
    (log.join() === "approve" && final === "SENT") ||
      (log.join() === "block" && final === "BLOCKED") ||
      (log.join() === "approve,block" && final === "BLOCKED"),
    `moderation history and final state disagree: ${story}`,
  )
  assert.ok(results.some((r) => r.success), "at least one moderator succeeded")

  // ── The send limit ────────────────────────────────────────────────────────
  const flooder: ChatViewer = { ...vKenya, userId: `${tag}-flooder` }
  let accepted = 0
  for (let i = 0; i < 25; i++) {
    const r = await sendCommitteeMessage(flooder, c1.id, { scope: "FLOOR", toPortfolioId: null, body: `spam ${i}` })
    if (!r.success) break
    accepted++
  }
  assert.equal(accepted, 20, "the 21st message in a minute is refused")

  } finally {
    // Tidy up even after a failure, so a rerun starts clean.
    const committees = (await prisma.committee.findMany({ where: { eventId: event.id }, select: { id: true } })).map((c) => c.id)
    const ids = (await prisma.committeeMessage.findMany({ where: { committeeId: { in: committees } }, select: { id: true } })).map((m) => String(m.id))
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } })
    await prisma.committeeMessage.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.allotment.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.portfolio.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.delegate.deleteMany({ where: { eventId: event.id } })
    await prisma.committee.deleteMany({ where: { eventId: event.id } })
    await prisma.event.delete({ where: { id: event.id } })
  }

  console.log("committee chat DB checks passed (per-viewer reads, approval, block and restore on catch-up, cross-committee, moderation race, send limit)")
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
