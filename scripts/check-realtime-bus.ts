#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-realtime-bus.ts
//
// These keep the realtime bus's rules real: publishing to a quiz room is staff-only, and the
// recruitment channels never admit a stranger.
import assert from "node:assert"
import { canPublish, canSubscribe, channelName, parseChannel } from "../src/lib/realtime/channels"
import { bus } from "../src/lib/realtime/bus"

const anon = { staff: false, authenticated: false }
const member = { staff: false, authenticated: true }
const staff = { staff: true, authenticated: true }

// ── Channel names ───────────────────────────────────────────────────────────
assert.deepEqual(parseChannel("quiz:AB12CD"), { kind: "quiz", id: "AB12CD" })
assert.deepEqual(parseChannel("recruitment:ckl9"), { kind: "recruitment", id: "ckl9" })
assert.equal(parseChannel("quiz:ab12"), null, "lowercase is not a room code; no silent coercion")
assert.equal(parseChannel("postgres_changes"), null, "an unknown channel must be refused, not created")
assert.equal(parseChannel("quiz:AB12CD;drop"), null, "punctuation must not slip into a channel name")
assert.equal(channelName({ kind: "quiz", id: "AB12CD" }), "quiz:AB12CD")

// ── Who may listen ──────────────────────────────────────────────────────────
const quiz = parseChannel("quiz:AB12CD")!
const recruitment = parseChannel("recruitment:ckl9")!
assert.equal(canSubscribe(quiz, anon), true, "a participant with the room code must be able to listen")
assert.equal(canSubscribe(recruitment, anon), false, "a stranger must never listen on recruitment")
assert.equal(canSubscribe(recruitment, member), true, "a signed-in member may listen on recruitment")

// ── Who may publish ─────────────────────────────────────────────────────────
assert.equal(canPublish(quiz, anon), false, "a participant must not be able to drive the room")
assert.equal(canPublish(quiz, member), false, "a signed-in non-staff user must not drive the room either")
assert.equal(canPublish(quiz, staff), true, "the host drives the room")
assert.equal(canPublish(recruitment, member), true, "any recruiter may nudge their own screens")

// ── The allotment board ─────────────────────────────────────────────────────
// Which seats are moving, and when, is staff business. A signed-in delegate must
// not be able to watch the board refresh, nor nudge organisers' screens.
{
  const board = parseChannel("allotment:evt_abc123")!
  assert.deepEqual(board, { kind: "allotment", id: "evt_abc123" })
  assert.equal(parseChannel("allotment:evt;drop"), null, "punctuation must not slip into an allotment channel")
  assert.equal(canSubscribe(board, anon), false, "a stranger must never watch the allotment board")
  assert.equal(canSubscribe(board, member), false, "a signed-in delegate must not watch the allotment board")
  assert.equal(canSubscribe(board, staff), true, "organisers watch their own board")
  assert.equal(canPublish(board, member), false, "a signed-in delegate must not nudge organisers' boards")
  assert.equal(canPublish(board, staff), true, "an organiser's allotment nudges the other boards")
}

// ── Online committees ───────────────────────────────────────────────────────
// A committee channel is its own delegates and the dais, and nobody drives it
// from a browser: server actions publish after they have authorised and written.
{
  const room = parseChannel("committee:cm_unsc01")!
  assert.deepEqual(room, { kind: "committee", id: "cm_unsc01" })
  assert.equal(parseChannel("committee:cm;drop"), null, "punctuation must not slip into a committee channel")
  assert.equal(parseChannel("committee:"), null, "a committee channel names its committee")
  const seated = { staff: false, authenticated: true, committeeIds: new Set(["cm_unsc01"]) }
  const elsewhere = { staff: false, authenticated: true, committeeIds: new Set(["cm_disec02"]) }
  assert.equal(canSubscribe(room, anon), false, "a stranger must never listen to a committee")
  assert.equal(canSubscribe(room, member), false, "being signed in is not a seat")
  assert.equal(canSubscribe(room, elsewhere), false, "a seat in another committee is not a seat in this one")
  assert.equal(canSubscribe(room, seated), true, "a seated delegate listens to their committee")
  assert.equal(canSubscribe(room, staff), true, "the dais listens to every committee")
  assert.equal(canPublish(room, seated), false, "a delegate must not publish to the committee")
  assert.equal(canPublish(room, staff), false, "not even staff publish from a browser")
  // Seats must not leak into other kinds of channel.
  assert.equal(canSubscribe(parseChannel("allotment:evt_abc123")!, seated), false)
}

// ── Fan-out and presence ────────────────────────────────────────────────────
{
  const seen: unknown[] = []
  const sub = (id: string, presence: { nickname: string; avatar: string; userId: string } | null) => ({
    id,
    channel: "quiz:AB12CD",
    presence,
    send: (event: string, data: unknown) => seen.push([id, event, data]),
  })

  const leaveA = bus.subscribe(sub("a", { nickname: "Ana", avatar: "x", userId: "u1" }))
  const leaveB = bus.subscribe(sub("b", { nickname: "Ben", avatar: "y", userId: "u2" }))
  assert.equal(bus.count("quiz:AB12CD"), 2)

  seen.length = 0
  assert.equal(bus.publish("quiz:AB12CD", "quiz", { event: "LOCK" }), 2, "both phones get the event")
  assert.equal(seen.length, 2)

  // A phone that reconnects keeps one presence row, so the lobby does not show
  // the same person twice and the nickname guard does not fire against itself.
  const leaveDup = bus.subscribe(sub("a2", { nickname: "Ana", avatar: "x", userId: "u1" }))
  assert.deepEqual(
    bus.presence("quiz:AB12CD").map((p) => p.userId).sort(),
    ["u1", "u2"],
    "presence is one entry per userId, not per socket",
  )

  leaveDup()
  leaveA()
  leaveB()
  assert.equal(bus.count("quiz:AB12CD"), 0, "leaving must drop the subscriber")
  assert.equal(bus.publish("quiz:AB12CD", "quiz", {}), 0, "an empty room delivers nothing")
}

// A socket that throws must not take the room down with it.
{
  const ok: string[] = []
  bus.subscribe({ id: "dead", channel: "quiz:ZZ99", presence: null, send: () => { throw new Error("gone") } })
  bus.subscribe({ id: "live", channel: "quiz:ZZ99", presence: null, send: (e) => ok.push(e) })
  bus.publish("quiz:ZZ99", "quiz", { event: "END" })
  assert.deepEqual(ok, ["quiz"], "the live phone still receives the event")
  assert.equal(bus.count("quiz:ZZ99"), 1, "the dead socket is dropped")
}

console.log("realtime bus checks passed (channel parsing, listen/publish rules, committees, fan-out, presence, dead sockets)")
