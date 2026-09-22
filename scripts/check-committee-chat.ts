// Runnable check for committee chat rules:
//   npx tsx scripts/check-committee-chat.ts
//
// Who can see a message is the whole security story of committee chat, so the
// rule is pinned exhaustively, and the database form of it is proved equal to
// the in-memory form across every combination rather than trusted to match.
import assert from "node:assert"
import {
  CURSOR_OVERLAP,
  MAX_BODY,
  addressedTo,
  canSee,
  changedWhere,
  decideModeration,
  decideSend,
  mergeMessages,
  moderationSince,
  normalizeBody,
  parseDraft,
  parseId,
  parseModerationAction,
  present,
  readAfter,
  visibleWhere,
  type ChatScope,
  type ChatState,
  type ChatViewer,
  type MessageFacts,
  type MessageView,
  type StoredMessage,
} from "../src/lib/committee/chat"

const dais: ChatViewer = { kind: "dais", userId: "u-dais", email: "chair@x.io" }
const del = (portfolioId: string): ChatViewer => ({
  kind: "delegate",
  userId: `u-${portfolioId}`,
  email: `${portfolioId}@x.io`,
  portfolioId,
  portfolioName: portfolioId,
})
const france = del("france")
const india = del("india")
const kenya = del("kenya")
const ctx = { seatIds: new Set(["france", "india", "kenya"]), holdDirectMessages: false }

// ── Body normalisation ──────────────────────────────────────────────────────
assert.equal(normalizeBody("  hello  "), "hello")
assert.equal(normalizeBody("a\r\nb\rc"), "a\nb\nc")
assert.equal(normalizeBody("a\n\n\n\n\nb"), "a\n\nb", "runs of blank lines collapse")
assert.equal(normalizeBody("​​​"), null, "zero-width only is empty, not a blank bubble")
assert.equal(normalizeBody("pay‮usd"), "payusd", "bidi overrides cannot reorder the text")
assert.equal(normalizeBody("a\u0000b\u0007c"), "abc", "control characters are removed")
assert.equal(normalizeBody("tab\there"), "tab\there", "tabs survive")
assert.equal(normalizeBody(""), null)
assert.equal(normalizeBody("x".repeat(MAX_BODY)), "x".repeat(MAX_BODY))
assert.equal(normalizeBody("x".repeat(MAX_BODY + 1)), null, "over the limit is refused, not truncated")

// ── Sending ─────────────────────────────────────────────────────────────────
const ok = (d: ReturnType<typeof decideSend>) => (d.ok ? d : assert.fail(`refused: ${JSON.stringify(d)}`))
const refused = (d: ReturnType<typeof decideSend>) => (d.ok ? assert.fail("should be refused") : d.reason)

assert.equal(ok(decideSend(france, { scope: "FLOOR", toPortfolioId: null, body: "hi" }, ctx)).state, "SENT")
assert.equal(ok(decideSend(france, { scope: "DM", toPortfolioId: "india", body: "hi" }, ctx)).state, "SENT")
assert.equal(
  ok(decideSend(france, { scope: "DM", toPortfolioId: "india", body: "hi" }, { ...ctx, holdDirectMessages: true })).state,
  "HELD",
  "with holding on, a DM waits for the dais",
)
assert.equal(
  ok(decideSend(france, { scope: "FLOOR", toPortfolioId: null, body: "hi" }, { ...ctx, holdDirectMessages: true })).state,
  "SENT",
  "holding applies to DMs only",
)
assert.equal(refused(decideSend(france, { scope: "DM", toPortfolioId: "france", body: "hi" }, ctx)), "bad-recipient", "no DMs to self")
assert.equal(refused(decideSend(france, { scope: "DM", toPortfolioId: "usa", body: "hi" }, ctx)), "bad-recipient", "recipient must be a seat in this committee")
assert.equal(refused(decideSend(france, { scope: "DM", toPortfolioId: null, body: "hi" }, ctx)), "bad-recipient")
assert.equal(refused(decideSend(france, { scope: "EB", toPortfolioId: "india", body: "hi" }, ctx)), "bad-recipient", "a delegate cannot address one seat through the dais thread")
assert.equal(refused(decideSend(france, { scope: "FLOOR", toPortfolioId: "india", body: "hi" }, ctx)), "bad-recipient")
assert.equal(refused(decideSend(france, { scope: "FLOOR", toPortfolioId: null, body: "  ​ " }, ctx)), "empty")
assert.equal(refused(decideSend(france, { scope: "FLOOR", toPortfolioId: null, body: "x".repeat(MAX_BODY + 1) }, ctx)), "too-long")
assert.equal(refused(decideSend(france, { scope: "FLOOR", toPortfolioId: null, body: "x".repeat(MAX_BODY * 10) }, ctx)), "too-long", "huge bodies are refused before any work")

assert.equal(ok(decideSend(dais, { scope: "FLOOR", toPortfolioId: null, body: "order" }, ctx)).toPortfolioId, null)
assert.equal(ok(decideSend(dais, { scope: "EB", toPortfolioId: "kenya", body: "noted" }, ctx)).toPortfolioId, "kenya")
assert.equal(refused(decideSend(dais, { scope: "EB", toPortfolioId: null, body: "x" }, ctx)), "bad-recipient", "a dais reply names its delegation")
assert.equal(refused(decideSend(dais, { scope: "EB", toPortfolioId: "usa", body: "x" }, ctx)), "bad-recipient")
assert.equal(refused(decideSend(dais, { scope: "DM", toPortfolioId: "india", body: "x" }, ctx)), "not-allowed")
assert.equal(ok(decideSend(dais, { scope: "FLOOR", toPortfolioId: null, body: "x" }, { ...ctx, holdDirectMessages: true })).state, "SENT", "the dais is never held")

// ── Visibility: the rules that matter, spelled out ──────────────────────────
const m = (scope: ChatScope, state: ChatState, from: string | null, to: string | null): MessageFacts => ({
  scope,
  state,
  fromPortfolioId: from,
  toPortfolioId: to,
})
assert.ok(canSee(kenya, m("FLOOR", "SENT", "france", null)), "everyone sees the floor")
assert.ok(canSee(kenya, m("FLOOR", "SENT", null, null)), "everyone sees the dais on the floor")
assert.ok(!canSee(kenya, m("DM", "SENT", "france", "india")), "a third delegation never sees a DM")
assert.ok(canSee(france, m("DM", "SENT", "france", "india")), "the sender sees its DM")
assert.ok(canSee(india, m("DM", "SENT", "france", "india")), "the recipient sees the DM")
assert.ok(canSee(france, m("DM", "HELD", "france", "india")), "the sender sees its own held DM")
assert.ok(!canSee(india, m("DM", "HELD", "france", "india")), "the recipient does not see it until approved")
assert.ok(!canSee(france, m("DM", "BLOCKED", "france", "india")), "a blocked message is gone even for its sender")
assert.ok(!canSee(kenya, m("FLOOR", "BLOCKED", "france", null)), "a blocked floor message is gone for everyone")
assert.ok(canSee(france, m("EB", "SENT", "france", null)), "a delegation sees what it sent the dais")
assert.ok(!canSee(india, m("EB", "SENT", "france", null)), "another delegation does not")
assert.ok(canSee(kenya, m("EB", "SENT", null, "kenya")), "a dais reply reaches its delegation")
assert.ok(!canSee(india, m("EB", "SENT", null, "kenya")), "and only that delegation")
for (const scope of ["FLOOR", "DM", "EB"] as const) {
  for (const state of ["SENT", "HELD", "BLOCKED"] as const) {
    assert.ok(canSee(dais, m(scope, state, "france", "india")), "the dais sees everything")
  }
}

// ── The database rule equals the in-memory rule, everywhere ─────────────────
// A small evaluator for the subset of Prisma `where` that visibleWhere and
// changedWhere use. If either grows a construct this does not understand, the
// check fails loudly rather than passing by accident.
type Row = MessageFacts & { committeeId: string; moderatedAt: Date | null }
function matches(where: Record<string, unknown>, row: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((w) => matches(w, row))) return false
      continue
    }
    const value = (row as unknown as Record<string, unknown>)[key]
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      const known = Object.keys(c).every((k) => k === "in" || k === "gt")
      assert.ok(known, `evaluator does not understand ${JSON.stringify(c)}`)
      if ("in" in c && !(c.in as unknown[]).includes(value)) return false
      if ("gt" in c && !(value instanceof Date && value > (c.gt as Date))) return false
      continue
    }
    if (value !== cond) return false
  }
  return true
}

const seats = ["france", "india", "kenya", null] as const
const viewers = [dais, france, india, kenya]
let combos = 0
for (const committeeId of ["c1", "c2"]) {
  for (const scope of ["FLOOR", "DM", "EB"] as const) {
    for (const state of ["SENT", "HELD", "BLOCKED"] as const) {
      for (const from of seats) {
        for (const to of seats) {
          for (const moderatedAt of [null, new Date(2_000), new Date(10_000)]) {
            const row: Row = { committeeId, scope, state, fromPortfolioId: from, toPortfolioId: to, moderatedAt }
            for (const v of viewers) {
              combos++
              const inCommittee = committeeId === "c1"
              assert.equal(
                matches(visibleWhere(v, "c1"), row),
                inCommittee && canSee(v, row),
                `visibleWhere disagrees with canSee: ${v.kind}/${v.kind === "delegate" ? v.portfolioId : ""} ${JSON.stringify(row)}`,
              )
              const since = new Date(5_000)
              assert.equal(
                matches(changedWhere(v, "c1", since), row),
                inCommittee && !!moderatedAt && moderatedAt > since && addressedTo(v, row),
                `changedWhere disagrees with addressedTo: ${JSON.stringify(row)}`,
              )
            }
          }
        }
      }
    }
  }
}
// Anything a viewer can see is addressed to it, so a moderation change to a
// visible message is always delivered.
for (const scope of ["FLOOR", "DM", "EB"] as const)
  for (const state of ["SENT", "HELD", "BLOCKED"] as const)
    for (const from of seats) for (const to of seats) for (const v of viewers) {
      const f = m(scope, state, from, to)
      if (canSee(v, f)) assert.ok(addressedTo(v, f))
    }

// ── What leaves the server ──────────────────────────────────────────────────
const stored: StoredMessage = {
  id: 7,
  ...m("DM", "SENT", "france", "india"),
  fromLabel: "France",
  toLabel: "India",
  authorEmail: "second-delegate@school.edu",
  body: "hi",
  moderatedAt: null,
  createdAt: new Date(0),
}
const delegateView = present(india, stored)
assert.ok(!("authorEmail" in delegateView), "a delegate's payload must not even carry the author key")
assert.ok(!JSON.stringify(delegateView).includes("second-delegate"), "nor the address anywhere")
assert.equal(present(dais, stored).authorEmail, "second-delegate@school.edu", "the dais sees who typed it")
assert.equal(present(france, stored).mine, true)
assert.equal(present(india, stored).mine, false)
assert.equal(present(dais, { ...stored, fromPortfolioId: null }).mine, true, "the dais's own messages are its own")

// ── Moderation ──────────────────────────────────────────────────────────────
assert.equal(decideModeration("HELD", "approve"), "SENT")
assert.equal(decideModeration("SENT", "approve"), null, "nothing to approve")
assert.equal(decideModeration("BLOCKED", "approve"), null, "approve does not un-block; restore does")
assert.equal(decideModeration("SENT", "block"), "BLOCKED")
assert.equal(decideModeration("HELD", "block"), "BLOCKED")
assert.equal(decideModeration("BLOCKED", "block"), null)
assert.equal(decideModeration("BLOCKED", "restore"), "SENT")
assert.equal(decideModeration("SENT", "restore"), null)

// ── Cursors ─────────────────────────────────────────────────────────────────
assert.equal(readAfter(null), 0)
assert.equal(readAfter(NaN), 0)
assert.equal(readAfter(-5), 0)
assert.equal(readAfter(10), 0, "overlap never goes negative")
assert.equal(readAfter(1000), 1000 - CURSOR_OVERLAP)
assert.equal(moderationSince(null).getTime(), 0)
assert.equal(moderationSince("not a date").getTime(), 0)
assert.equal(moderationSince(new Date(100_000).toISOString()).getTime(), 70_000, "30s overlap behind the cursor")

// ── Merging on the client ───────────────────────────────────────────────────
const v = (id: number, body = `m${id}`): MessageView => ({
  id, scope: "FLOOR", state: "SENT", fromPortfolioId: "france", toPortfolioId: null,
  fromLabel: "France", toLabel: null, body, createdAt: new Date(id).toISOString(), mine: false,
})
const held = [v(1), v(2), v(3)]
assert.deepEqual(mergeMessages(held, [v(3), v(4), v(2)]).map((x) => x.id), [1, 2, 3, 4], "overlap dedupes and keeps order")
assert.deepEqual(mergeMessages(held, [], [2]).map((x) => x.id), [1, 3], "a blocked message leaves screens that already had it")
assert.deepEqual(mergeMessages(held, [v(2, "edited")]).find((x) => x.id === 2)?.body, "edited", "the fresh copy wins")
assert.deepEqual(mergeMessages(held, [], [99]).map((x) => x.id), [1, 2, 3], "removing an unknown id is harmless")
const once = mergeMessages(held, [v(4)], [1])
assert.deepEqual(mergeMessages(once, [v(4)], [1]), once, "replaying the same fetch changes nothing")

// ── Input from server actions ───────────────────────────────────────────────
assert.deepEqual(parseDraft({ scope: "DM", toPortfolioId: "cm_abc", body: "hi" }), { scope: "DM", toPortfolioId: "cm_abc", body: "hi" })
assert.deepEqual(parseDraft({ scope: "FLOOR", body: "hi" }), { scope: "FLOOR", toPortfolioId: null, body: "hi" })
assert.equal(parseDraft(null), null)
assert.equal(parseDraft("FLOOR"), null)
assert.equal(parseDraft({ scope: "SYSTEM", body: "hi" }), null, "an unknown scope is refused, not defaulted")
assert.equal(parseDraft({ scope: "FLOOR", body: 42 }), null)
assert.equal(parseDraft({ scope: "DM", toPortfolioId: "x'; drop", body: "hi" }), null, "ids are shape-checked")
assert.equal(parseDraft({ scope: "DM", toPortfolioId: { not: null }, body: "hi" }), null, "no Prisma operators smuggled in as ids")
assert.equal(parseDraft({ scope: "FLOOR", body: "x".repeat(MAX_BODY * 4 + 1) }), null, "oversized bodies stop at the door")
assert.equal(parseId("cm_unsc01"), "cm_unsc01")
assert.equal(parseId(""), null)
assert.equal(parseId(["cm_unsc01"]), null)
assert.equal(parseModerationAction("block"), "block")
assert.equal(parseModerationAction("delete"), null)

console.log(`committee chat checks passed (sending, visibility, ${combos} where-clause combinations, payload, moderation, cursors, merge)`)
