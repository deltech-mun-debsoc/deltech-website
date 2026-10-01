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

  assert.equal(mayEnterCommittees({ chair: false, emailVerified: null, disabledAt: null }), false,
    "an unverified delegate account must not reach a committee: anyone can claim an unused address")
  assert.equal(mayEnterCommittees({ chair: false, emailVerified: now, disabledAt: null }), true)
  assert.equal(mayEnterCommittees({ chair: false, emailVerified: now, disabledAt: now }), false, "a disabled account is out")
  assert.equal(mayEnterCommittees({ chair: true, emailVerified: null, disabledAt: null }), true, "a chair enters by assignment")
  assert.equal(mayEnterCommittees({ chair: true, emailVerified: now, disabledAt: now }), false, "even a chair, once disabled")

  // Staff are not the dais. The viewer must not grant anything by role beyond
  // CHAIR, or the secretariat would be back inside every committee.
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(new URL("../src/lib/committee/viewer.ts", import.meta.url), "utf8")
  assert.doesNotMatch(src, /STAFF_ROLES|requireStaff/, "committee access must not be granted by a staff role")
  assert.match(src, /chairs: \{ some: \{ userId \} \}/, "a chair reaches only committees they are assigned to")

  console.log("committee viewer checks passed (verified address, disabled accounts, chairs by assignment)")
}
main().catch((e) => { console.error(e); process.exit(1) })
