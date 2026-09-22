// Runnable check: npx tsx scripts/check-committee-viewer.ts
//
// Committee membership rests on matching the session's email to a delegate row,
// because there is no key between them. That is only safe for an address the
// account has proved it owns, so the gate is pinned here independently of
// whatever sign-in does.
import assert from "node:assert"

async function main() {
  const { mayEnterCommittees } = await import("../src/lib/committee/viewer")
  const now = new Date()

  assert.equal(mayEnterCommittees({ staff: false, emailVerified: null, disabledAt: null }), false,
    "an unverified delegate account must not reach a committee: anyone can claim an unused address")
  assert.equal(mayEnterCommittees({ staff: false, emailVerified: now, disabledAt: null }), true)
  assert.equal(mayEnterCommittees({ staff: false, emailVerified: now, disabledAt: now }), false, "a disabled account is out")
  assert.equal(mayEnterCommittees({ staff: true, emailVerified: null, disabledAt: null }), true, "staff enter by role")
  assert.equal(mayEnterCommittees({ staff: true, emailVerified: now, disabledAt: now }), false, "even staff, once disabled")

  console.log("committee viewer checks passed (verified address, disabled accounts, staff by role)")
}
main().catch((e) => { console.error(e); process.exit(1) })
