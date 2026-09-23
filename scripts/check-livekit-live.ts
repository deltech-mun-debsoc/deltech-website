// Live checks for committee video against a real LiveKit server:
//   docker compose -f dev/livekit.yml up -d
//   LIVEKIT_LIVE_CHECKS=1 LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey \
//     LIVEKIT_API_SECRET=devsecret-devsecret-devsecret-devsecret DATABASE_URL=... \
//     npx tsx scripts/check-livekit-live.ts
//
// check-livekit-video.ts proves the rules in memory. This proves the assumptions
// the design rests on, against the real server:
//   1. revoking canPublish removes tracks a participant already published,
//      rather than only refusing new ones (the whole speaker-only design);
//   2. the floor changing grants and revokes on the live connection;
//   3. an identity this app did not mint is removed on join;
//   4. webhooks LiveKit really sends verify with our code.
//
// Test participants are livekit-cli containers joined into the server's own
// network namespace, so the loopback address LiveKit advertises is reachable.
// Opt-in; refuses production and staging databases and any non-local SFU.
import assert from "node:assert"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { promisify } from "node:util"

const run = promisify(execFile)

if (process.env.LIVEKIT_LIVE_CHECKS !== "1") {
  console.log("livekit live checks skipped (set LIVEKIT_LIVE_CHECKS=1 with a local LiveKit to run)")
  process.exit(0)
}

const LIVEKIT_CONTAINER = process.env.LIVEKIT_CONTAINER ?? "mun-livekit-dev-livekit-1"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until<T>(label: string, probe: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms
  let last: unknown
  while (Date.now() < end) {
    try {
      const v = await probe()
      if (v) return v as T
    } catch (err) {
      last = err
    }
    await sleep(300)
  }
  throw new Error(`timed out waiting for: ${label}${last ? ` (last error: ${String(last)})` : ""}`)
}

async function main() {
  const { liveKitConfig } = await import("../src/lib/livekit/config")
  const config = liveKitConfig()
  assert.ok(config, "LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set")
  assert.ok(/^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(config.url), `refusing a non-local SFU: ${config.url}`)

  const { prisma } = await import("../src/lib/prisma")
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`
  assert.ok(!/^mun_(prod|staging)$/.test(db), `refusing to write test data into ${db}`)

  const { RoomServiceClient, AccessToken } = await import("livekit-server-sdk")
  const { mintFloorToken, syncFloorRoom, syncJoiningParticipant, lobbyOccupancy, recordVisit, mintVoiceTokens } = await import("../src/lib/livekit/server")
  const { visitFromWebhook, lobbyRoomName } = await import("../src/lib/livekit/voice")
  const { verifyWebhook } = await import("../src/lib/livekit/webhook")
  const { runDaisOp } = await import("../src/lib/committee/floor-server")
  const { floorRoomName, participantIdentity } = await import("../src/lib/livekit/video")
  const rooms = new RoomServiceClient(config.httpUrl, config.apiKey, config.apiSecret)

  // ── Webhooks: capture what LiveKit really sends ───────────────────────────
  const hooks: { body: string; auth: string | null }[] = []
  const hookServer = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      hooks.push({ body, auth: (req.headers.authorization as string) ?? null })
      res.end("ok")
    })
  })
  await new Promise<void>((r) => hookServer.listen(3000, "0.0.0.0", r))

  const tag = `lklive${Date.now()}`
  const containers: string[] = []
  const event = await prisma.event.create({ data: { name: tag, slug: tag, state: "ARCHIVED" } })
  try {
    const committee = await prisma.committee.create({ data: { eventId: event.id, name: tag, slug: tag, format: "ONLINE" } })
    const seat = async (name: string) => {
      const p = await prisma.portfolio.create({ data: { committeeId: committee.id, name } })
      const d = await prisma.delegate.create({
        data: { eventId: event.id, fullName: name, email: `${name}.${tag}@x.io`, whatsapp: "1", institution: "X" },
      })
      await prisma.allotment.create({ data: { delegateId: d.id, committeeId: committee.id, portfolioId: p.id, allottedBy: "check" } })
      return p
    }
    const france = await seat("France")
    const india = await seat("India")
    const session = await prisma.committeeSession.create({ data: { committeeId: committee.id, state: "ACTIVE", startedAt: new Date() } })
    await prisma.sessionAttendance.createMany({
      data: [france, india].map((p) => ({ sessionId: session.id, portfolioId: p.id, status: "PRESENT" as const })),
    })
    const room = floorRoomName(session.id)

    const dais = { kind: "dais" as const, userId: `${tag}-dais`, email: "chair@x.io" }
    const fr = { kind: "delegate" as const, userId: `${tag}-fr`, email: "fr@x.io", portfolioId: france.id, portfolioName: "France" }

    // ── Tokens carry the floor as it is at mint time ────────────────────────
    const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())
    const frToken = await mintFloorToken(fr, committee.id)
    assert.ok(frToken)
    const frClaims = claims(frToken.token)
    assert.equal(frClaims.video.room, room)
    assert.equal(frClaims.video.canPublish, false, "a delegate not holding the floor gets no publish right")
    assert.equal(frClaims.video.canPublishData, false)
    assert.equal(frClaims.sub, participantIdentity({ kind: "delegate", userId: fr.userId, portfolioId: france.id }))
    assert.equal(claims((await mintFloorToken(dais, committee.id))!.token).video.canPublish, true, "the dais may publish")

    // ── Join real participants. The CLI mints its own full-rights token, which
    // is exactly the case that matters: someone who can publish, and does. ──
    const join = async (name: string, identity: string, publish: boolean) => {
      containers.push(name)
      await run("docker", [
        "run", "-d", "--rm", "--name", name, "--network", `container:${LIVEKIT_CONTAINER}`,
        "livekit/livekit-cli:latest", "room", "join",
        "--url", "ws://localhost:7880", "--api-key", config.apiKey, "--api-secret", config.apiSecret,
        "--identity", identity, ...(publish ? ["--publish-demo"] : []), room,
      ])
    }
    const frIdentity = participantIdentity({ kind: "delegate", userId: fr.userId, portfolioId: france.id })
    await join(`${tag}-fr`, frIdentity, true)
    await join(`${tag}-rogue`, "rogue-not-minted-here", false)

    const find = async (identity: string) => (await rooms.listParticipants(room)).find((p) => p.identity === identity)
    const published = await until("France to publish its demo video", async () => {
      const p = await find(frIdentity)
      return p && p.tracks.length > 0 ? p : null
    }, 45_000)
    console.log(`  France joined and is publishing ${published.tracks.length} track(s) with canPublish=${published.permission?.canPublish}`)

    // ── 1. Revoking removes what is already published ───────────────────────
    // France does not hold the floor, so syncing must revoke, and the tracks
    // already flowing must disappear, not just be barred from growing.
    await syncFloorRoom(committee.id)
    const revoked = await until("France's tracks to be removed after revoking", async () => {
      const p = await find(frIdentity)
      return p && p.permission?.canPublish === false && p.tracks.length === 0 ? p : null
    })
    assert.equal(revoked.tracks.length, 0)
    console.log("  1. revoking canPublish removed the tracks France had already published")

    // ── 2. The floor grants and revokes on the live connection ──────────────
    const version = async () => (await prisma.committeeSession.findUniqueOrThrow({ where: { id: session.id } })).version
    const daisOk = async (op: Parameters<typeof runDaisOp>[3]) => {
      const r = await runDaisOp(dais, committee.id, await version(), op)
      assert.ok(r.success, `${op.op}: ${r.success ? "" : r.error}`)
    }
    await daisOk({ op: "addSpeaker", portfolioId: france.id, motionId: null })
    await daisOk({ op: "nextSpeaker", motionId: null })
    await until("France to be granted on becoming the speaker", async () => (await find(frIdentity))?.permission?.canPublish === true)
    console.log("  2a. calling France to speak granted publish on the live connection")
    const speaking = await prisma.speakerEntry.findFirstOrThrow({ where: { sessionId: session.id, state: "SPEAKING" } })
    await daisOk({ op: "endSpeaker", entryId: speaking.id })
    await until("France to lose publish when the speech ends", async () => (await find(frIdentity))?.permission?.canPublish === false)
    console.log("  2b. ending the speech revoked it again")

    // ── 3. An identity this app did not mint is removed ─────────────────────
    await until("the rogue participant to be in the room", () => find("rogue-not-minted-here"))
    await syncJoiningParticipant(room, "rogue-not-minted-here")
    await until("the rogue participant to be removed", async () => !(await find("rogue-not-minted-here")))
    console.log("  3. a participant with an identity we never issued was removed")

    // ── 4. Webhooks LiveKit really signed verify with our code ──────────────
    const joined = await until("a participant_joined webhook from LiveKit", async () => {
      for (const h of hooks) {
        const ev = await verifyWebhook(config, h.body, h.auth)
        if (ev?.event === "participant_joined" && ev.room?.name === room) return { h, ev }
      }
      return null
    })
    assert.equal(await verifyWebhook(config, joined.h.body.replace(room, room + "x"), joined.h.auth), null,
      "a real webhook altered in transit is refused")
    const forged = new AccessToken(config.apiKey, "not-the-real-secret-not-the-real-secret")
    assert.equal(await verifyWebhook(config, joined.h.body, await forged.toJwt()), null, "a forged signature is refused")
    console.log(`  4. ${hooks.length} real webhooks received; LiveKit's signature verifies, tampering and forgery do not`)

    // ── 5. Lobbies: tokens, real visits from real webhooks, occupancy ───────
    const tokens = await mintVoiceTokens(fr, committee.id)
    assert.ok(tokens && tokens.lobbies.length === 6, "six lobby tokens minted at once")
    const lobbyClaims = claims(tokens.lobbies[0].token).video
    assert.deepEqual(lobbyClaims.canPublishSources, ["microphone"], "a lobby token publishes the microphone and nothing else")
    assert.equal(lobbyClaims.room, lobbyRoomName(session.id, 1))
    assert.equal(tokens.floor.room, room, "the floor token comes with them, for the warm connection")

    // Feed every webhook LiveKit sends from here on through the real handler path.
    const seen = new Set<string>()
    const pump = async () => {
      for (const h of hooks) {
        if (seen.has(h.body)) continue
        seen.add(h.body)
        const ev = await verifyWebhook(config, h.body, h.auth)
        if (!ev) continue
        const change = visitFromWebhook({
          event: ev.event, room: ev.room?.name ?? "", participantSid: ev.participant?.sid ?? "",
          identity: ev.participant?.identity ?? "", at: ev.createdAt ? new Date(Number(ev.createdAt) * 1000) : new Date(),
        })
        if (change) await recordVisit(change)
      }
    }
    const inIdentity = participantIdentity({ kind: "delegate", userId: `${tag}-in`, portfolioId: india.id })
    const lobby3 = lobbyRoomName(session.id, 3)
    const joinLobby = async (name: string, identity: string, target: string) => {
      containers.push(name)
      await run("docker", [
        "run", "-d", "--rm", "--name", name, "--network", `container:${LIVEKIT_CONTAINER}`,
        "livekit/livekit-cli:latest", "room", "join",
        "--url", "ws://localhost:7880", "--api-key", config.apiKey, "--api-secret", config.apiSecret,
        "--identity", identity, target,
      ])
    }
    await joinLobby(`${tag}-in-lobby`, inIdentity, lobby3)
    const occupied = await until("India to show in Lobby 3", async () => {
      const occ = await lobbyOccupancy(committee.id)
      return occ?.[3].some((o) => o.identity === inIdentity) ? occ : null
    })
    assert.deepEqual(occupied[1], [], "the other channels stay empty")
    const visit = await until("India's visit to be recorded from the webhook", async () => {
      await pump()
      return prisma.voiceChannelVisit.findFirst({ where: { identity: inIdentity, room: lobby3, joinedAt: { not: null } } })
    })
    assert.equal(visit.slot, 3)
    assert.equal(visit.portfolioId, india.id)
    assert.equal(visit.committeeId, committee.id)
    await run("docker", ["rm", "-f", `${tag}-in-lobby`])
    const closed = await until("India's visit to close when they leave", async () => {
      await pump()
      const v = await prisma.voiceChannelVisit.findUnique({ where: { id: visit.id } })
      return v?.leftAt ? v : null
    }, 40_000)
    assert.ok(closed.leftAt! >= closed.joinedAt!)
    await until("Lobby 3 to be empty again", async () => {
      // The cache is short; wait it out rather than reaching into it.
      await sleep(1600)
      const occ = await lobbyOccupancy(committee.id)
      return occ && occ[3].length === 0
    })
    // A retried webhook changes nothing: replay every one of them.
    seen.clear()
    await pump()
    assert.equal(await prisma.voiceChannelVisit.count({ where: { identity: inIdentity } }), 1, "replayed webhooks do not double a visit")
    console.log("  5. lobby tokens are microphone-only; a real join and leave were recorded once each; occupancy followed LiveKit")

    console.log("livekit live checks passed (revocation unpublishes, floor grants and revokes live, rogue removal, real webhook signatures, lobby visits and occupancy)")
  } finally {
    for (const c of containers) await run("docker", ["rm", "-f", c]).catch(() => {})
    hookServer.close()
    const committees = (await prisma.committee.findMany({ where: { eventId: event.id }, select: { id: true } })).map((c) => c.id)
    await prisma.voiceChannelVisit.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.committeeSession.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.allotment.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.portfolio.deleteMany({ where: { committeeId: { in: committees } } })
    await prisma.delegate.deleteMany({ where: { eventId: event.id } })
    await prisma.committee.deleteMany({ where: { eventId: event.id } })
    await prisma.event.delete({ where: { id: event.id } })
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
