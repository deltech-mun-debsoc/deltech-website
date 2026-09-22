// Runnable check for who may publish in a floor room:
//   npx tsx scripts/check-livekit-video.ts
import assert from "node:assert"
import { liveKitConfig } from "../src/lib/livekit/config"
import {
  floorRoomName,
  grantsFor,
  mayPublish,
  parseIdentity,
  participantIdentity,
  permissionChanges,
  publishersFor,
} from "../src/lib/livekit/video"

// ── Configuration: off unless complete, and never unencrypted off-box ───────
const full = { LIVEKIT_URL: "wss://sfu.example.com", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" }
assert.deepEqual(liveKitConfig(full), { url: "wss://sfu.example.com", apiKey: "k", apiSecret: "s", httpUrl: "https://sfu.example.com" })
assert.equal(liveKitConfig({}), null, "no settings means video is off, not an error")
assert.equal(liveKitConfig({ ...full, LIVEKIT_API_SECRET: " " }), null, "a blank secret is no secret")
assert.equal(liveKitConfig({ ...full, LIVEKIT_URL: "https://sfu.example.com" }), null, "must be a websocket URL")
assert.equal(liveKitConfig({ ...full, LIVEKIT_URL: "ws://sfu.example.com" }), null, "plain ws:// only on this machine")
assert.equal(liveKitConfig({ ...full, LIVEKIT_URL: "ws://localhost:7880" })?.httpUrl, "http://localhost:7880")
assert.equal(liveKitConfig({ ...full, LIVEKIT_URL: "ws://localhost.evil.com" }), null, "localhost must be the host, not a prefix")

// ── Identity ────────────────────────────────────────────────────────────────
const alice = { kind: "delegate" as const, userId: "u1", portfolioId: "p_fr" }
const bob = { kind: "delegate" as const, userId: "u2", portfolioId: "p_fr" } // co-delegate of France
assert.notEqual(participantIdentity(alice), participantIdentity(bob), "two people on one seat must not share an identity")
assert.deepEqual(parseIdentity(participantIdentity(alice)), { kind: "seat", portfolioId: "p_fr", userId: "u1" })
assert.deepEqual(parseIdentity("dais:u9"), { kind: "dais", userId: "u9" })
for (const junk of ["", "seat:p", "seat::u", "dais:", "admin:u1", "seat:p:u:extra", "dais:u1\n", "seat:p;x:u"]) {
  assert.equal(parseIdentity(junk), null, `refuse identity ${JSON.stringify(junk)}`)
}
assert.equal(floorRoomName("cs_1"), "floor_cs_1")

// ── Who publishes ───────────────────────────────────────────────────────────
const idle = publishersFor({ gsl: null, caucus: null })
const gsl = publishersFor({ gsl: "p_fr", caucus: null })
assert.equal(mayPublish("dais:u9", idle), true, "the dais always publishes")
assert.equal(mayPublish(participantIdentity(alice), idle), false, "nobody else while nobody holds the floor")
assert.equal(mayPublish(participantIdentity(alice), gsl), true, "the speaker publishes")
assert.equal(mayPublish(participantIdentity(bob), gsl), true, "and so does their co-delegate: rights are per seat")
assert.equal(mayPublish("seat:p_in:u3", gsl), false, "another seat does not")
assert.equal(mayPublish("someone-else", gsl), false, "an identity this app did not mint never publishes")
assert.deepEqual([...publishersFor({ gsl: "p_fr", caucus: "p_in" })].sort(), ["p_fr", "p_in"])

const g = grantsFor(alice, "floor_cs_1", idle)
assert.equal(g.canPublish, false)
assert.equal(g.canSubscribe, true)
assert.equal(g.canPublishData, false, "no data channel beside moderated chat")
assert.equal(g.canUpdateOwnMetadata, false, "no renaming oneself on the dais's screen")
assert.equal(grantsFor(alice, "r", gsl).canPublish, true, "a speaker joining late gets the grant in the token")
assert.equal(grantsFor({ kind: "dais", userId: "u9" }, "r", idle).canPublish, true)

// ── Syncing a live room ─────────────────────────────────────────────────────
const room = [
  { identity: "dais:u9", canPublish: true },
  { identity: "seat:p_fr:u1", canPublish: false },
  { identity: "seat:p_in:u3", canPublish: true }, // spoke last, must lose it
  { identity: "seat:p_de:u4", canPublish: false },
  { identity: "rogue", canPublish: true },
]
assert.deepEqual(permissionChanges(room, gsl), [
  { identity: "seat:p_fr:u1", canPublish: true },
  { identity: "seat:p_in:u3", canPublish: false },
  { identity: "rogue", canPublish: false },
], "grant the new speaker, revoke the old one and anything unknown, leave the rest")
assert.deepEqual(permissionChanges(permissionChanges(room, gsl).length ? room.map((p) => ({ ...p, canPublish: mayPublish(p.identity, gsl) })) : room, gsl), [],
  "an in-sync room needs no calls")

console.log("livekit video checks passed (config, identity, publish rights, grants, room sync)")
