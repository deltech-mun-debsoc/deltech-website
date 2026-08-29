// Runnable check for role-aware landing: npx tsx scripts/check-nav.ts
import assert from "node:assert"
import { roleHome, safeLanding } from "../src/lib/nav"

// ── roleHome ─────────────────────────────────────────────────────────────────
assert.equal(roleHome("ADMIN"), "/admin")
assert.equal(roleHome("MAINTAINER"), "/admin")
assert.equal(roleHome("MEMBER"), "/account")
assert.equal(roleHome("AUTHOR"), "/write")
assert.equal(roleHome("REGISTERER"), "/dashboard")
assert.equal(roleHome(undefined), "/")
assert.equal(roleHome("NONSENSE"), "/")

// ── safeLanding: open-redirect rejection → role home ─────────────────────────
assert.equal(safeLanding("//evil.com", "ADMIN"), "/admin")
assert.equal(safeLanding("https://evil.com", "ADMIN"), "/admin")
assert.equal(safeLanding("http://evil.com", "REGISTERER"), "/dashboard")
assert.equal(safeLanding("/\\evil.com", "ADMIN"), "/admin")
assert.equal(safeLanding("evil.com", "ADMIN"), "/admin") // no leading slash
assert.equal(safeLanding(null, "AUTHOR"), "/write")
assert.equal(safeLanding("", "REGISTERER"), "/dashboard")

// ── safeLanding: honor same-origin path when the role may access it ──────────
assert.equal(safeLanding("/admin", "ADMIN"), "/admin")
assert.equal(safeLanding("/admin/users", "MAINTAINER"), "/admin/users")
assert.equal(safeLanding("/blog", "REGISTERER"), "/blog") // public path, anyone
assert.equal(safeLanding("/write/new", "AUTHOR"), "/write/new")
assert.equal(safeLanding("/dashboard", "REGISTERER"), "/dashboard")

// ── safeLanding: downgrade when the role can't access the target (no loop) ───
assert.equal(safeLanding("/admin", "REGISTERER"), "/dashboard")
assert.equal(safeLanding("/write", "REGISTERER"), "/dashboard")
assert.equal(safeLanding("/dashboard", "ADMIN"), "/admin") // staff never land on /dashboard
assert.equal(safeLanding("/write", "MAINTAINER"), "/write") // staff may author

// ── safeLanding: absolute same-origin URLs (what NextAuth's bounce emits) ────
const ORIGIN = "https://app.example.com"
assert.equal(safeLanding("https://app.example.com/admin", "ADMIN", ORIGIN), "/admin")
assert.equal(safeLanding("https://app.example.com/admin/users?tab=1", "ADMIN", ORIGIN), "/admin/users?tab=1")
assert.equal(safeLanding("https://app.example.com/blog#top", "REGISTERER", ORIGIN), "/blog#top")
// same-origin but role can't reach it → downgrade, not bounce
assert.equal(safeLanding("https://app.example.com/admin", "REGISTERER", ORIGIN), "/dashboard")
// Foreign origin → role home, never off-site. These use a public path + a role
// whose home differs from it, so a leaked-through value can't masquerade as a
// correct downgrade.
assert.equal(safeLanding("https://evil.com/blog", "REGISTERER", ORIGIN), "/dashboard")
assert.equal(safeLanding("https://app.example.com.evil.com/blog", "REGISTERER", ORIGIN), "/dashboard") // suffix trick
assert.equal(safeLanding("https://evil.com/?x=https://app.example.com/blog", "REGISTERER", ORIGIN), "/dashboard")
assert.equal(safeLanding("http://app.example.com/blog", "REGISTERER", ORIGIN), "/dashboard") // scheme mismatch
// absolute URL with no origin supplied → cannot verify, so refuse
assert.equal(safeLanding("https://app.example.com/admin", "ADMIN"), "/admin")
assert.equal(safeLanding("https://app.example.com/blog", "REGISTERER"), "/dashboard")
// non-http schemes are never honored
assert.equal(safeLanding("javascript:alert(1)", "ADMIN", ORIGIN), "/admin")
assert.equal(safeLanding("//evil.com", "ADMIN", ORIGIN), "/admin")

// /account is reachable by every signed-in role. The account page bounces an
// anonymous visitor to /signin?callbackUrl=/account, so if safeLanding refused
// to honour that path they would sign in and land on their home instead, with
// no way to reach the page they asked for.
assert.equal(safeLanding("/account", "ADMIN", ORIGIN), "/account")
assert.equal(safeLanding("/account", "MAINTAINER", ORIGIN), "/account")
assert.equal(safeLanding("/account", "MEMBER", ORIGIN), "/account")
assert.equal(safeLanding("/account", "AUTHOR", ORIGIN), "/account")
assert.equal(safeLanding("/account", "REGISTERER", ORIGIN), "/account")
assert.equal(safeLanding("https://app.example.com/account", "REGISTERER", ORIGIN), "/account")
// ...but an unauthenticated caller still gets the public home, not /account.
assert.equal(safeLanding("/account", undefined, ORIGIN), "/")

// ── Recruitment area / SUB_MAINTAINER (Junior Council) ───────────────────────
// A JC account's only surface is /recruitment.
assert.equal(roleHome("SUB_MAINTAINER"), "/recruitment")
assert.equal(safeLanding(null, "SUB_MAINTAINER"), "/recruitment")
assert.equal(safeLanding("/recruitment/gd", "SUB_MAINTAINER"), "/recruitment/gd")

// The structural rule: a JC can never be landed on the admin dashboard, however
// the callbackUrl is dressed up.
assert.equal(safeLanding("/admin", "SUB_MAINTAINER"), "/recruitment")
assert.equal(safeLanding("/admin/users", "SUB_MAINTAINER"), "/recruitment")
assert.equal(safeLanding("/admin/config/money", "SUB_MAINTAINER"), "/recruitment")
assert.equal(safeLanding("https://app.example.com/admin", "SUB_MAINTAINER", ORIGIN), "/recruitment")
// ...nor on the other privileged surfaces.
assert.equal(safeLanding("/write", "SUB_MAINTAINER"), "/recruitment")
assert.equal(safeLanding("/dashboard", "SUB_MAINTAINER"), "/recruitment")
// Open-redirect protection still applies to the new role.
assert.equal(safeLanding("//evil.com", "SUB_MAINTAINER"), "/recruitment")
assert.equal(safeLanding("https://evil.com/recruitment", "SUB_MAINTAINER", ORIGIN), "/recruitment")

// Any authenticated role may be assigned to a cycle, so /recruitment is reachable
// by all of them. The authoritative gate is requireRecruitmentAccess() in the
// (recruitment) layout, which checks RecruitmentMember in the database — the edge
// cannot, so it must not pre-emptively refuse.
for (const role of ["ADMIN", "MAINTAINER", "MEMBER", "AUTHOR", "REGISTERER", "SUB_MAINTAINER"]) {
  assert.equal(
    safeLanding("/recruitment", role),
    "/recruitment",
    `${role} must be able to land on /recruitment`,
  )
}
// Unauthenticated callers are never landed there.
assert.equal(safeLanding("/recruitment", null), "/")
assert.equal(safeLanding("/recruitment", undefined), "/")

console.log("nav checks passed")
