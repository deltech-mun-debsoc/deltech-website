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
  STAGE_SHORTCUTS,
} from "../src/lib/mailer/audience"
import { MAIL_PRESETS, presetFor } from "../src/lib/mailer/presets"
import { campaignStateLabel, dailyLimitNote, recoveryFor } from "../src/lib/mailer/recovery"

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
  assert.deepEqual((unpaid.AND as unknown[]).slice(2), [{ allotment: { is: { emailSentAt: { not: null } } } }, { payment: { status: { in: ["PENDING", "SENT"] } } }])

  // Untrusted JSON: an unknown status must not reach the query.
  assert.deepEqual(parseDelegateAudience({ statuses: ["DROP TABLE"] }), parseDelegateAudience({}), "invalid filters fall back to the safe default")
  assert.deepEqual((buildDelegateAudienceWhere(parseDelegateAudience({}), scope).AND as unknown[])[0], scope, "the event scope is always applied")

  // Hand-picked from the delegate list: exactly those people, still only in this event.
  const picked = buildDelegateAudienceWhere(parseDelegateAudience({ delegateIds: ["d1", "d2"], statuses: ["CONFIRMED"] }), scope)
  assert.deepEqual(picked, { AND: [scope, { id: { in: ["d1", "d2"] } }] }, "hand-picked ignores filters but keeps the event scope")
  assert.deepEqual(parseDelegateAudience({ delegateIds: Array(5001).fill("x") }).delegateIds, [], "an oversized pick falls back to the safe default")

  // Stage shortcuts are ordinary filters, so they must survive parsing unchanged.
  for (const s of STAGE_SHORTCUTS) {
    const parsed = parseDelegateAudience(s.filters)
    assert.deepEqual({ ...parsed, ...s.filters }, parsed, `${s.key} is a valid audience`)
  }
  const unpaidStage = STAGE_SHORTCUTS.find((s) => s.key === "allotted-unpaid")!
  assert.deepEqual(
    (buildDelegateAudienceWhere(parseDelegateAudience(unpaidStage.filters), scope).AND as unknown[]).slice(2),
    [{ allotment: { is: { emailSentAt: { not: null } } } }, { payment: { status: { in: ["PENDING", "SENT", "FAILED"] } } }],
  )
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
  // Every mail's footer already names the secretariat address, so a preset that
  // says it again prints it twice. Caught in the first real send on staging.
  for (const preset of MAIL_PRESETS) {
    assert.ok(!preset.build(ctx).body.includes(ctx.secretariatEmail), `${preset.key} repeats the contact address the footer already gives`)
  }
}


// ── The guarantees that live in code, not in pure functions ─────────────────
// Each of these fails silently if it regresses: a duplicate mail, a PR blast
// nobody switched on, or an unsubscribe that anyone could forge.
{
  const queue = readFileSync("src/lib/mailer/queue.ts", "utf8")
  const actions = readFileSync("src/app/(admin)/admin/(event)/mailer/actions.ts", "utf8")
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
  assert.match(stale.slice(0, 300), /data: \{ status: "UNCERTAIN"/, "an interrupted send is uncertain, never back to PENDING and a second copy")

  // Event mail and PR outreach share a table; neither list may show the other.
  const list = readFileSync("src/app/(admin)/admin/(event)/mailer/_components/campaign-list.tsx", "utf8")
  assert.match(list, /where: \{ audience, /, "a campaign list is always filtered by its audience")
  // Drafting from the delegate list only drafts: sending stays ADMIN only.
  const draftFn = actions.slice(actions.indexOf("export async function draftMailForDelegates"), actions.indexOf("// ---- Outreach contacts ----"))
  assert.match(draftFn, /requireStaff\(\)/)
  assert.match(draftFn, /eventId: event\.id/, "a drafted delegate mail belongs to the running event")
  assert.doesNotMatch(draftFn, /processMailQueue|scheduleCampaign\(/, "drafting must never send")

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

// ── SES bounces and complaints ──────────────────────────────────────────────
//
// AWS requires a process for these, and the audience filters have always assumed
// one: MailContact.bouncedAt excludes an address from every send, and nothing
// wrote it until the SES webhook existed.
{
  const ses = readFileSync("src/app/api/webhooks/ses/route.ts", "utf8")
  assert.match(ses, /timingSafeEqual/, "the SES webhook must compare its secret in constant time")
  assert.match(ses, /bouncedAt: now/, "a permanent bounce must suppress the address")
  assert.match(ses, /unsubscribedAt: now/, "a spam complaint must stop further mail to that address")
  assert.match(
    ses,
    /sns\\\.\[a-z0-9-\]\+\\\.amazonaws\\\.com/,
    "only a real SNS host may be fetched for subscription confirmation",
  )
  // SNS delivers at least once, so the same bounce arrives twice in practice.
  // Suppression is idempotent; the log row has to be made so deliberately.
  assert.match(ses, /contains: `\[ses:\$\{messageId\}\]`/, "a repeated SES event must not be logged twice")
  assert.ok(
    ses.indexOf("if (already) return") < ses.indexOf("prisma.emailLog.create"),
    "the duplicate check must run before the row is written",
  )

  // A transient bounce is a full mailbox, not a dead address. Suppressing on one
  // would quietly drop a delegate who is still reachable tomorrow.
  assert.ok(
    ses.indexOf("if (permanent) {") < ses.indexOf("mailContact.updateMany"),
    "only a permanent bounce may suppress an address",
  )
}

// ── Provider limits ─────────────────────────────────────────────────────────
//
// SES throws rather than queues when either limit is exceeded, and a throw in the
// queue marks that recipient FAILED without a retry, so both ceilings are pinned.
{
  const queue = readFileSync("src/lib/mailer/queue.ts", "utf8")
  assert.match(queue, /function maxPerSecond/, "the queue must pace itself against the provider's rate limit")
  assert.match(queue, /=== "ses" \? 14 : 2/, "SES allows 14 messages a second on this account")
  assert.match(queue, /=== "ses" \? 45_000 : 90/, "the daily cap must leave headroom under the 50,000 quota")
  assert.match(queue, /minBatchMs - elapsed/, "batches must wait out the remainder of their rate window")
}

// ── A campaign with failures is not called "Sent" ───────────────────────────
{
  assert.equal(campaignStateLabel("SENT", { SENT: 20, FAILED: 2 }), "Completed with 2 failures")
  assert.equal(campaignStateLabel("SENT", { SENT: 20, FAILED: 1, UNCERTAIN: 1 }), "Completed with 1 failure and 1 to check")
  assert.equal(campaignStateLabel("SENT", { SENT: 22 }), "Completed")
  assert.equal(campaignStateLabel("CANCELLED", { SENT: 3 }), "Stopped part way")
}

// ── Each failed recipient gets the one safe action ──────────────────────────
{
  const failed = (error: string) => ({ status: "FAILED", email: "a@x.in", error })
  assert.equal(recoveryFor(failed("Throttling: rate exceeded")).kind, "retry", "a transient failure can be retried")
  assert.equal(recoveryFor(failed("Bounced: 550 no such user"), "a@x.in").kind, "fix-address", "a bounce is fixed, not retried")
  const fixed = recoveryFor(failed("Bounced: 550 no such user"), "A.New@x.in")
  assert.equal(fixed.kind, "retry", "once the delegate's address changes, the retry goes there")
  assert.equal(fixed.kind === "retry" && fixed.newEmail, "a.new@x.in")
  assert.equal(recoveryFor(failed("Marked as spam: abuse"), "a@x.in").kind, "fix-address")
  assert.equal(recoveryFor({ status: "UNCERTAIN", email: "a@x.in", error: "Interrupted" }).kind, "check", "an interrupted send may have arrived")
  assert.equal(recoveryFor({ status: "SENT", email: "a@x.in", error: null }).kind, "none", "someone who got it is never offered a retry")
}

// ── The daily limit is said, with when it frees up ──────────────────────────
{
  assert.equal(dailyLimitNote({ sentLast24h: 10, cap: 90, pending: 5, oldestInWindow: null }), null, "room left: nothing to say")
  assert.equal(dailyLimitNote({ sentLast24h: 90, cap: 90, pending: 0, oldestInWindow: null }), null, "nothing waiting: nothing to say")
  assert.match(dailyLimitNote({ sentLast24h: 90, cap: 90, pending: 40, oldestInWindow: new Date("2026-10-07T04:30:00Z") }) ?? "", /^40 waiting for the daily sending limit \(90 a day\); more can go from about 10:00 am/)
}

// ── Recovery wiring ──────────────────────────────────────────────────────────
{
  const queue = readFileSync("src/lib/mailer/queue.ts", "utf8")
  assert.match(queue, /status: "UNCERTAIN", error: "Interrupted/, "an interrupted send is uncertain, not failed")
  const actions = readFileSync("src/app/(admin)/admin/(event)/mailer/actions.ts", "utf8")
  assert.match(actions, /status: \{ in: \["FAILED", "UNCERTAIN"\] \}/, "a retry only ever moves recipients who were not reached")
  assert.match(actions, /action\.kind === "check" && confirmed\.has\(r\.id\)/, "an uncertain send is retried only when a person says they checked")
  assert.match(actions, /processMailQueue\(new Date\(\), campaignId\)/, "the batch button sends this campaign only")
}

console.log("mailer checks passed (merge fields, unsubscribe tokens, audiences, frequency cap, presets, PR gate, claims, one-click unsubscribe)")
