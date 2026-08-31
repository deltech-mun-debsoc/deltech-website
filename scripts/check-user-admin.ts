#!/usr/bin/env tsx
// Locks the account-lifecycle decisions that gate destructive user actions.
//
// The DB-side half (the "at least one enabled ADMIN survives" invariant) is
// enforced by a Serializable transaction in the users actions and cannot be
// asserted without a database. What is asserted here is the pure logic those
// actions branch on, plus the session-freshness rule that decides how long a
// disabled or deleted account keeps working.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import {
  SESSION_REVALIDATE_MS,
  sessionNeedsRefresh,
  deleteBlockReason,
} from "../src/lib/user-admin"

const NOW = 1_800_000_000_000

// --- session freshness -----------------------------------------------------

// A token minted before this feature existed has no stamp, so it must never be
// trusted; otherwise old sessions would keep a deleted account alive forever.
assert.equal(sessionNeedsRefresh(undefined, NOW), true, "missing checkedAt must force a re-read")
assert.equal(sessionNeedsRefresh(null, NOW), true, "null checkedAt must force a re-read")
assert.equal(sessionNeedsRefresh("1800000000000", NOW), true, "non-numeric checkedAt must force a re-read")
assert.equal(sessionNeedsRefresh(NaN, NOW), true, "NaN checkedAt must force a re-read")

// A forged or skewed future stamp must not buy unlimited freshness.
assert.equal(sessionNeedsRefresh(NOW + 60_000, NOW), true, "future checkedAt must force a re-read")

assert.equal(sessionNeedsRefresh(NOW, NOW), false, "a stamp from this instant is fresh")
assert.equal(
  sessionNeedsRefresh(NOW - (SESSION_REVALIDATE_MS - 1), NOW),
  false,
  "just inside the window is fresh",
)
assert.equal(
  sessionNeedsRefresh(NOW - SESSION_REVALIDATE_MS, NOW),
  true,
  "exactly at the window must re-read",
)
assert.equal(
  sessionNeedsRefresh(NOW - SESSION_REVALIDATE_MS * 10, NOW),
  true,
  "long-stale must re-read",
)

// The window is the revocation delay a compromised account gets. Keep it short.
assert.ok(SESSION_REVALIDATE_MS <= 5 * 60_000, "revocation delay must stay under 5 minutes")

// --- hard-delete preconditions ---------------------------------------------

assert.equal(deleteBlockReason(0, 0), null, "an account owning nothing is safe to delete")

// Post.authorId is ON DELETE RESTRICT, so this delete would throw P2003.
const onePost = deleteBlockReason(1, 0)
assert.ok(onePost, "an account with a post must not be hard-deleted")
assert.match(onePost!, /1 blog post\b/, "singular post wording")
assert.match(onePost!, /Disable it instead/, "must point at the reversible alternative")

assert.match(deleteBlockReason(3, 0)!, /3 blog posts\b/, "plural post wording")

// Presentation.ownerId has no FK, so the DB would NOT stop this one. The
// application check is the only thing preventing an orphaned quiz.
const oneQuiz = deleteBlockReason(0, 1)
assert.ok(oneQuiz, "an account owning a presentation must not be hard-deleted")
assert.match(oneQuiz!, /1 quiz\b/, "singular quiz wording")
assert.match(deleteBlockReason(0, 2)!, /2 quizzes\b/, "plural quiz wording")

assert.match(
  deleteBlockReason(2, 1)!,
  /2 blog posts and 1 quiz\b/,
  "both kinds are reported together",
)

// --- changing an app role moves recruitment access with it ------------------
//
// Recruitment roles are derived from the app role, but cycles still hold a
// RecruitmentMember row per person and that row overrides the derived role. So a
// demotion in /admin/users that left the row behind would not actually remove
// recruitment access -- which is the entire offboarding path. setUserRole syncs
// them in the same transaction as the role write.
{
  const src = readFileSync("src/app/(admin)/admin/users/actions.ts", "utf8")
  const setUserRole = src.slice(src.indexOf("export async function setUserRole"), src.indexOf("export async function setUserDisabled"))
  assert.match(setUserRole, /derivedRecruitmentRole\(role\)/, "setUserRole must resolve the derived recruitment role")
  assert.match(setUserRole, /tx\.recruitmentMember\.updateMany/, "the membership sync must run inside withAdminInvariant's transaction")
  assert.match(setUserRole, /isActive: false/, "a role with no recruitment authority must revoke live memberships")
  assert.match(setUserRole, /data: \{ role: recruitmentRole \}/, "a role with recruitment authority must move memberships to it")
}

console.log("✅ check-user-admin passed")
