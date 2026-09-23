// Runnable check for lobbying voice channels:
//   npx tsx scripts/check-livekit-voice.ts
import assert from "node:assert"
import { TrackSource } from "livekit-server-sdk"
import {
  LOBBY_SLOTS,
  lobbyGrants,
  lobbyRoomName,
  occupancy,
  parseRoomName,
  visitFromWebhook,
} from "../src/lib/livekit/voice"
import { floorRoomName } from "../src/lib/livekit/video"

const sid = "cmfsess0000abcd"

// ── Room names round-trip, and nothing else parses ──────────────────────────
for (const slot of LOBBY_SLOTS) {
  assert.deepEqual(parseRoomName(lobbyRoomName(sid, slot)), { kind: "lobby", sessionId: sid, slot })
}
assert.deepEqual(parseRoomName(floorRoomName(sid)), { kind: "floor", sessionId: sid })
for (const junk of ["", "lobby_", `lobby_${sid}_0`, `lobby_${sid}_7`, `lobby_${sid}_1x`, `lobby_${sid}`, "floor_", "other_x", `lobby_${sid}_1;drop`]) {
  assert.equal(parseRoomName(junk), null, `refuse room ${JSON.stringify(junk)}`)
}
assert.equal(LOBBY_SLOTS.length, 6)
assert.equal(new Set(LOBBY_SLOTS.map((s) => lobbyRoomName(sid, s))).size, 6, "every channel is its own room")
assert.notEqual(lobbyRoomName(sid, 1), lobbyRoomName("cmfsess0000abce", 1), "sessions never share a room")

// ── Lobby tokens: microphone and nothing else ───────────────────────────────
const g = lobbyGrants(lobbyRoomName(sid, 3))
assert.deepEqual(g.canPublishSources, [TrackSource.MICROPHONE], "audio only, enforced by the SFU")
assert.equal(g.canPublish, true)
assert.equal(g.canPublishData, false, "no data side channel")
assert.equal(g.canUpdateOwnMetadata, false, "no renaming oneself")

// ── Webhooks to visits ──────────────────────────────────────────────────────
const at = new Date(1_000)
const joined = visitFromWebhook({ event: "participant_joined", room: lobbyRoomName(sid, 2), participantSid: "PA_1", identity: "seat:p_fr:u1", at })
assert.deepEqual(joined, {
  kind: "join", sessionId: sid, slot: 2, room: lobbyRoomName(sid, 2), participantSid: "PA_1", identity: "seat:p_fr:u1", portfolioId: "p_fr", at,
})
assert.equal(visitFromWebhook({ event: "participant_left", room: lobbyRoomName(sid, 2), participantSid: "PA_1", identity: "seat:p_fr:u1", at })?.kind, "leave")
assert.equal(visitFromWebhook({ event: "participant_joined", room: lobbyRoomName(sid, 2), participantSid: "PA_2", identity: "dais:u9", at })?.portfolioId, null, "the dais is recorded with no seat")
assert.equal(visitFromWebhook({ event: "participant_joined", room: floorRoomName(sid), participantSid: "PA_1", identity: "seat:p_fr:u1", at }), null, "the floor is not a lobby")
assert.equal(visitFromWebhook({ event: "participant_joined", room: lobbyRoomName(sid, 2), participantSid: "PA_1", identity: "rogue", at }), null, "identities we did not mint are not recorded")
assert.equal(visitFromWebhook({ event: "room_started", room: lobbyRoomName(sid, 2), participantSid: "PA_1", identity: "seat:p_fr:u1", at }), null)
assert.equal(visitFromWebhook({ event: "participant_joined", room: lobbyRoomName(sid, 2), participantSid: "", identity: "seat:p_fr:u1", at }), null, "no sid, no idempotency key, no record")

// ── Occupancy ───────────────────────────────────────────────────────────────
const occ = occupancy([
  { slot: 1, participants: [{ identity: "seat:p_fr:u1", name: "France" }, { identity: "dais:u9", name: "Dais" }] },
  { slot: 4, participants: [{ identity: "rogue", name: "Totally the Chair" }] },
])
assert.deepEqual(occ[1].map((o) => [o.name, o.dais]), [["France", false], ["Dais", true]])
assert.deepEqual(occ[4], [], "an identity we did not mint is never shown, whatever name it gave itself")
assert.deepEqual(Object.keys(occ).map(Number), [...LOBBY_SLOTS], "every channel is listed, empty or not")

console.log("livekit voice checks passed (room names, audio-only grants, webhook visits, occupancy)")
