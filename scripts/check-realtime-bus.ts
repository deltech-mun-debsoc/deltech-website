#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-realtime-bus.ts
//
// The realtime bus replaced Supabase. Supabase's own rule was "anyone with the
// publishable key can publish anywhere", so these assertions exist to stop us
// drifting back to that: publishing to a quiz room is staff-only, and the
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

console.log("realtime bus checks passed (channel parsing, listen/publish rules, fan-out, presence, dead sockets)")
