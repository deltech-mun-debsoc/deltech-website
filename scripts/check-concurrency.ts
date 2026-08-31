#!/usr/bin/env tsx
// Locks the concurrency fixes that can be checked without a database.
//
// Most of these bugs live in the *shape* of a query (read-then-write vs a
// conditional write) rather than in a pure function, so this asserts the
// shape statically. A regression here is a silent double-send or a silently
// dropped registration, neither of which surfaces in a build.
import assert from "node:assert"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(p, "utf8")

// --- Razorpay: the write is the guard, not the read ------------------------
//
// payment.captured and payment_link.paid both arrive for one payment-link
// payment, milliseconds apart. Reading status then writing unconditionally
// let both through: two confirmation emails, two EmailLog rows.
{
  const src = read("src/app/api/webhooks/razorpay/route.ts")

  assert.match(
    src,
    /updateMany\(\{\s*where: \{ id: payment\.id, status: \{ notIn: \["PAID", "OFFLINE", "COMPED"\] \} \}/,
    "the confirm path must use a conditional updateMany, not a bare update",
  )
  assert.match(src, /if \(count === 0\) return false/, "a lost race must return early")
  assert.match(
    src,
    /if \(!confirmed\) return NextResponse\.json/,
    "sendPaymentConfirmed must be gated on winning the write",
  )
  // The email must come after the guard, never unconditionally.
  assert.ok(
    src.indexOf("if (!confirmed)") < src.indexOf("sendPaymentConfirmed(delegateId)"),
    "the confirmation email must be unreachable when the update matched 0 rows",
  )
}

// --- holdPortfolio reports whether *this* caller took the hold -------------
//
// It used to discard the count and always return success, so `heldByUs` was
// always true, `onHoldByOther` always false, and the soft-lock warning could
// never render.
{
  const src = read("src/app/(admin)/admin/allotment/actions.ts")
  assert.match(src, /holdToken = randomUUID\(\)/, "every hold needs an unguessable owner token")
  assert.match(src, /holdExpiresAt/, "holds need an expiry so an abandoned dialog self-heals")
  assert.match(src, /where: \{ id: portfolioId, status: "ON_HOLD", holdToken \}/, "only a hold owner may release it")
  assert.doesNotMatch(
    src,
    /await prisma\.portfolio\.updateMany\(\{[\s\S]{0,200}?\}\)\s*\n\s*return \{ success: true \}/,
    "holdPortfolio must not discard the updateMany result",
  )

  // The allotment is committed before the payment link is generated, so a
  // provider outage must not skip the email/audit/sheet-sync that follow.
  assert.match(src, /let payLinkFailed = false/, "pay-link failure must be tracked, not thrown")
  assert.match(src, /warning:/, "a partial success must be reported as a warning, not a failure")
}

// Only the dialog knows whether it took the hold, so only the dialog may
// release it. The board used to branch on the server-rendered status, which
// never matched our own hold and did match someone else's.
{
  const dialog = read("src/app/(admin)/admin/allotment/_components/allot-dialog.tsx")
  const board = read("src/app/(admin)/admin/allotment/_components/allotment-board.tsx")
  assert.match(dialog, /releaseHold\(portfolio\.id, holdToken\)/, "the dialog must release with its hold token")
  assert.match(dialog, /holdToken,\s*\}/, "allotment confirmation must prove it owns the hold")
  assert.doesNotMatch(board, /releaseHold/, "the board must not release holds it knows nothing about")
}

// --- a paid allotment cannot commit without a fee -------------------------
{
  const src = read("src/app/(admin)/admin/allotment/actions.ts")
  assert.match(src, /if \(paymentsEnabled && !fee\)/, "a paid allotment must stop when its fee is missing")
  assert.ok(
    src.indexOf("if (paymentsEnabled && !fee)") < src.indexOf("await tx.allotment.create"),
    "the fee guard must run before the allotment is committed",
  )
}

// --- autosave must not change review state --------------------------------
{
  const src = read("src/app/(author)/write/[id]/actions.ts")
  assert.match(
    src,
    /status:\s*post\.status === "PENDING" \? "PENDING" : "DRAFT"/,
    "saveDraft must preserve PENDING; forcing DRAFT pulls a submitted post out of review",
  )
}

// --- intake tells portfolio contention from a duplicate person -------------
//
// Both surface as P2002. Reporting contention as "duplicate" dropped a real
// registration: the transaction rolls back, so the Delegate is never created.
{
  const src = read("src/lib/intake.ts")
  assert.match(src, /function conflictTarget/, "P2002 must be disambiguated by meta.target")
  assert.match(
    src,
    /if \(target\.includes\("portfolioId"\)\)/,
    "a portfolio collision must be handled separately from a duplicate email",
  )
  assert.ok(
    src.indexOf('target.includes("portfolioId")') <
      src.indexOf('reason: "duplicate", errors: [`${row.email} already registered`]'),
    "the portfolio-collision branch must be checked before falling back to duplicate",
  )
  assert.match(
    src,
    /Portfolio already taken[\s\S]{0,400}?quarantinedRow\.create/,
    "a lost portfolio race must be quarantined, never silently dropped",
  )
}

// --- the reminder cron is exclusive and does not re-mail failures ---------
{
  const src = read("src/app/api/cron/payment-reminder/route.ts")
  assert.match(src, /async function claimRun/, "overlapping runs must be prevented by a lock")
  assert.match(src, /skipped: "already running"/, "a second concurrent run must no-op")
  assert.ok(
    src.indexOf("claimRun()") < src.indexOf("prisma.delegate.findMany"),
    "the lock must be claimed before candidates are selected",
  )
  // Only counting status:"SENT" meant a permanently bouncing address was
  // re-selected on every run and burned one of the 80 daily slots.
  assert.doesNotMatch(
    src,
    /template: "payment-reminder",\s*\n\s*status: "SENT"/,
    "the dedupe window must count attempts, not just successes",
  )
  assert.match(src, /Promise\.allSettled/, "sends must not be strictly sequential")
}

// --- quiz session creation exists once, and is guarded --------------------
{
  const shared = read("src/lib/quiz-session.ts")
  assert.match(shared, /isolationLevel: "Serializable"/, "two presenters must not create two rooms")
  assert.match(shared, /P2002/, "a roomCode collision must be retried, not thrown")

  for (const p of [
    "src/app/(admin)/admin/quiz/[id]/present/actions.ts",
    "src/app/api/quiz/sessions/route.ts",
  ]) {
    const src = read(p)
    assert.match(src, /createOrGetQuizSession/, `${p} must use the shared helper`)
    assert.doesNotMatch(
      src,
      /function generateRoomCode/,
      `${p} still has its own copy of room-code generation`,
    )
  }
}

// --- the quiz double-submit guard is a DB constraint, not just a check ----
{
  const schema = read("prisma/schema.prisma")
  assert.match(
    schema,
    /@@unique\(\[sessionId, slideId, nickname\]\)/,
    "Response needs a unique index; the findFirst check alone loses the race",
  )
  const route = read("src/app/api/quiz/responses/route.ts")
  assert.match(route, /ON CONFLICT DO NOTHING/, "the database must decide one winner for a double submission")
  assert.match(route, /alreadySubmitted: true/, "the constraint violation needs an idempotent receipt")
  assert.match(route, /FOR SHARE/, "answer admission must serialize with lock, reveal and end")

  // The migration must clear pre-existing duplicates or the index cannot build.
  const migration = read(
    "prisma/migrations/20260729130000_response_unique_submission/migration.sql",
  )
  assert.match(migration, /DELETE FROM "Response"/, "existing duplicates must be removed first")
  assert.ok(
    migration.indexOf("DELETE FROM") < migration.indexOf("CREATE UNIQUE INDEX"),
    "the dedupe must run before the index is created",
  )
}

console.log("✅ check-concurrency passed")
