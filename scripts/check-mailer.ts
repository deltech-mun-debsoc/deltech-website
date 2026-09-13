#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-mailer.ts
//
// A mailer's mistakes land in hundreds of inboxes at once and cannot be called
// back, so the parts that decide what is sent and to whom are pinned here.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { renderMerge, unfilledFields, paragraphs, firstName } from "../src/lib/mailer/merge"
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../src/lib/mailer/unsubscribe"
import {
  buildDelegateAudienceWhere,
  buildContactAudienceWhere,
  parseDelegateAudience,
  parseContactAudience,
  CONTACT_FREQUENCY_CAP_DAYS,
} from "../src/lib/mailer/audience"
import { MAIL_PRESETS, presetFor } from "../src/lib/mailer/presets"

// ── Merge fields ────────────────────────────────────────────────────────────
{
  assert.equal(renderMerge("Hi {firstName}, you are {portfolio}.", { firstName: "Ria", portfolio: "India" }), "Hi Ria, you are India.")
  assert.equal(renderMerge("Hi {nmae}", { name: "Ria" }), "Hi {nmae}", "a misspelt field must stay visible, not vanish")
  assert.equal(renderMerge("Seat: {committee}", {}), "Seat: {committee}", "a field with no value must stay visible in the preview")
  assert.deepEqual(unfilledFields("{name} in {committee} {nmae}", { name: "Ria" }), ["committee", "nmae"])
  assert.equal(firstName("  Ria   Sharma "), "Ria")
  assert.deepEqual(paragraphs("one\nline\n\n\ntwo"), ["one\nline", "two"])
}

// ── Unsubscribe tokens ──────────────────────────────────────────────────────
{
  const secret = "test-secret"
  const token = signUnsubscribeToken("contact_123", secret)
  assert.equal(verifyUnsubscribeToken(token, secret), "contact_123")
  assert.equal(verifyUnsubscribeToken(token, "other-secret"), null, "a token must not verify under another secret")
  assert.equal(verifyUnsubscribeToken(token.replace("contact_123", "contact_999"), secret), null, "changing the id must break the token")
  assert.equal(verifyUnsubscribeToken("contact_123", secret), null)
  assert.equal(verifyUnsubscribeToken(`${token}x`, secret), null)
  assert.throws(() => signUnsubscribeToken("contact_123", ""), "signing without a secret must fail loudly")
}

// ── Delegate audience ───────────────────────────────────────────────────────
{
  const scope = { eventId: "evt_1" }
  const all = buildDelegateAudienceWhere(parseDelegateAudience({}), scope)
  assert.deepEqual(all, { AND: [scope, { status: { not: "CANCELLED" } }] }, "by default: this event, cancelled delegates left out")

  const chosen = buildDelegateAudienceWhere(parseDelegateAudience({ statuses: ["CANCELLED"] }), scope)
  assert.deepEqual((chosen.AND as unknown[])[1], { status: { in: ["CANCELLED"] } }, "cancelled delegates only when asked for")

  const unpaid = buildDelegateAudienceWhere(parseDelegateAudience({ allotted: "yes", paymentStatuses: ["PENDING", "SENT"] }), scope)
  assert.deepEqual((unpaid.AND as unknown[]).slice(2), [{ allotment: { isNot: null } }, { payment: { status: { in: ["PENDING", "SENT"] } } }])

  // Untrusted JSON: an unknown status must not reach the query.
  assert.deepEqual(parseDelegateAudience({ statuses: ["DROP TABLE"] }), parseDelegateAudience({}), "invalid filters fall back to the safe default")
  assert.deepEqual((buildDelegateAudienceWhere(parseDelegateAudience({}), scope).AND as unknown[])[0], scope, "the event scope is always applied")
}

// ── Contact audience ────────────────────────────────────────────────────────
{
  const now = new Date("2026-09-14T00:00:00.000Z")
  const w = buildContactAudienceWhere(parseContactAudience({ tags: ["dtu"] }), now)
  const and = w.AND as Record<string, unknown>[]
  assert.deepEqual(and[0], { unsubscribedAt: null }, "unsubscribed contacts are never mailed")
  assert.deepEqual(and[1], { bouncedAt: null }, "bounced addresses are never mailed")
  const cutoff = new Date(now.getTime() - CONTACT_FREQUENCY_CAP_DAYS * 86400000)
  assert.deepEqual(and[2], { OR: [{ lastMailedAt: null }, { lastMailedAt: { lt: cutoff } }] }, "the frequency cap applies")
  assert.deepEqual(and[3], { tags: { hasSome: ["dtu"] } })
}

// ── Presets ─────────────────────────────────────────────────────────────────
{
  const ctx = {
    eventName: "Intra MUN 2026", dates: "10 October 2026", venue: "DTU", registerUrl: "https://x/register",
    whatsappUrl: "", secretariatEmail: "sec@x", paymentDeadline: "", daysToGo: 3,
  }
  for (const preset of MAIL_PRESETS) {
    const draft = preset.build(ctx)
    assert.ok(!/undefined|null|NaN/.test(`${draft.subject} ${draft.body}`), `${preset.key} must not leak undefined into copy`)
    assert.ok(!draft.body.includes("—") && !draft.subject.includes("—"), `${preset.key} must not use em dashes`)
    if (preset.key !== "custom") assert.ok(draft.subject.trim(), `${preset.key} needs a subject`)
    if (draft.ctaLabel) assert.ok(draft.ctaUrl, `${preset.key} has a button with nowhere to go`)
  }
  assert.equal(presetFor("countdown").build(ctx).subject, "3 days to Intra MUN 2026")
  assert.equal(presetFor("countdown").build({ ...ctx, daysToGo: 1 }).subject, "1 day to Intra MUN 2026")
  assert.equal(presetFor("nope").key, "custom")
}


// ── The guarantees that live in code, not in pure functions ─────────────────
// Each of these fails silently if it regresses: a duplicate mail, a PR blast
// nobody switched on, or an unsubscribe that anyone could forge.
{
  const queue = readFileSync("src/lib/mailer/queue.ts", "utf8")
  const actions = readFileSync("src/app/(admin)/admin/mailer/actions.ts", "utf8")
  const resend = readFileSync("src/lib/resend.ts", "utf8")
  const unsub = readFileSync("src/app/api/unsubscribe/[token]/route.ts", "utf8")

  // PR mail stays off until switched on, at every layer that could send it.
  assert.match(queue, /if \(campaign\.audience === "CONTACTS" && !prOn\) continue/, "a PR campaign must not start while PR mail is off")
  assert.match(queue, /\.\.\.\(prOn \? \{\} : \{ audience: "DELEGATES" \}\)/, "PR recipients must not send while PR mail is off")
  assert.match(actions, /campaign\.audience === "CONTACTS" && !\(await prMailEnabled\(\)\)/, "scheduling a PR campaign must be refused while PR mail is off")

  // Nobody is mailed twice by overlapping runs.
  assert.match(
    queue,
    /updateMany\(\{\s*where: \{ id: r\.id, status: "PENDING" \},\s*data: \{ status: "SENDING"/,
    "each recipient must be claimed with a conditional update before it is sent",
  )
  assert.match(queue, /updateMany\(\{\s*where: \{ id: campaign\.id, state: "SCHEDULED" \}/, "a campaign must be claimed before its recipients are resolved")
  const stale = queue.slice(queue.indexOf('status: "SENDING", claimedAt: { lt:'))
  assert.match(stale.slice(0, 300), /data: \{ status: "FAILED"/, "an interrupted send must fail, never go back to PENDING and risk a second copy")

  // Outreach mail is unsubscribable in one click.
  assert.match(resend, /"List-Unsubscribe": `<\$\{input\.unsubscribePostUrl\}>`/)
  assert.match(resend, /"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/)

  // The unsubscribe endpoint trusts the signature, not the id.
  assert.ok(
    unsub.indexOf("verifyUnsubscribeToken(") < unsub.indexOf("mailContact.updateMany"),
    "the token must be verified before any contact is changed",
  )
  assert.match(unsub, /where: \{ id: contactId, unsubscribedAt: null \}/, "unsubscribing twice must keep the first time")
  // Behind the standalone server req.url is the bind address, so a redirect built
  // from it lands on https://0.0.0.0:3000. Found on staging.
  assert.doesNotMatch(unsub, /new URL\([^)]*req\.url/, "unsubscribe redirects must be built from APP_URL, never req.url")
}

console.log("mailer checks passed (merge fields, unsubscribe tokens, audiences, frequency cap, presets, PR gate, claims, one-click unsubscribe)")
