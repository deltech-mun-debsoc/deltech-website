#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-realtime-client.ts
//
// One connection per channel, however many components subscribe.
//
// This is not a style preference. The recruitment screens mount the realtime
// hook once per candidate row, so a connection per subscriber meant ~100
// EventSources on one page. In production that pegged the tab's main thread:
// every stream reconnected in a loop (207 connections in 15 minutes, each
// lasting ~10ms), the renderer froze, and clicking "Move to FINALISATION" did
// nothing at all, because a frozen page cannot dispatch a server action.
//
// Supabase multiplexed every channel onto one WebSocket and hid the problem.
import assert from "node:assert"

// Minimal EventSource stand-in: records what was opened and closed, and lets the
// test deliver frames.
class FakeEventSource {
  static opened: FakeEventSource[] = []
  closed = false
  listeners = new Map<string, ((e: { data: string }) => void)[]>()
  constructor(public url: string) {
    FakeEventSource.opened.push(this)
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) })
  }
}
;(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource

// Imported after the stub exists, because the module captures EventSource lazily
// but the check must never open a real connection.
import { subscribeShared } from "../src/lib/realtime/client"


const seen: string[] = []
const listener = (name: string, event?: string) => ({
  handlers: { event, onEvent: () => seen.push(name), onOpen: () => seen.push(`${name}:open`) },
})

// ── Many subscribers, one connection ────────────────────────────────────────
const a = listener("a", "changed")
const b = listener("b", "changed")
const c = listener("c", "changed")
const leaveA = subscribeShared("recruitment:x|", "/api/realtime?channel=recruitment:x", a)
const leaveB = subscribeShared("recruitment:x|", "/api/realtime?channel=recruitment:x", b)
const leaveC = subscribeShared("recruitment:x|", "/api/realtime?channel=recruitment:x", c)

assert.equal(
  FakeEventSource.opened.length,
  1,
  "one hundred rows on a recruitment page must still be one connection, not one hundred",
)

const conn = FakeEventSource.opened[0]
conn.emit("changed", { topic: "candidate" })
assert.deepEqual(seen, ["a", "b", "c"], "every subscriber on the shared connection receives the event")

// ── Reference counting ──────────────────────────────────────────────────────
leaveA()
leaveB()
assert.equal(conn.closed, false, "a row unmounting must not disconnect the rows still on screen")
leaveC()
assert.equal(conn.closed, true, "the last subscriber leaving closes the connection")

// ── A different identity is a different room ────────────────────────────────
const before = FakeEventSource.opened.length
subscribeShared("quiz:AB12CD|u1|Ana|x", "/api/realtime?channel=quiz:AB12CD", listener("ana"))
subscribeShared("quiz:AB12CD|u2|Ben|y", "/api/realtime?channel=quiz:AB12CD", listener("ben"))
assert.equal(
  FakeEventSource.opened.length - before,
  2,
  "two identities in one tab are two presences, so they cannot share a connection",
)

// ── Frames the page cannot parse must not take the stream down ──────────────
{
  const l = listener("weird", "changed")
  subscribeShared("quiz:ZZ99|", "/api/realtime?channel=quiz:ZZ99", l)
  const s = FakeEventSource.opened[FakeEventSource.opened.length - 1]
  const bad = s.listeners.get("changed")![0]
  assert.doesNotThrow(() => bad({ data: "not json" }), "a malformed frame must be skipped, not thrown")
}

console.log("realtime client checks passed (one connection per channel, refcounting, identity split)")
