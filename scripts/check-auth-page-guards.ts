// Runnable check: npx tsx scripts/check-auth-page-guards.ts
//
// The auth pages are doors, not destinations. /signin, /signin/staff and
// /signup all rendered their form unconditionally, so a signed-in visitor got
// a login screen that reads as "you are logged out" with no way forward but to
// authenticate a second time. /signup did guard, but redirected to a hardcoded
// /dashboard -- the REGISTERER home -- so a signed-in admin was sent to a page
// their role has no business on and bounced again.
//
// Both failures are the same shape: a destination decided locally. All doors now
// share landingFor (src/lib/landing.ts), which /go uses too.
import assert from "node:assert"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const APP = join(__dirname, "..", "src", "app", "(public)")

// /go is the dispatcher itself; the three doors must use the same one.
const PAGES = ["go/page.tsx", "signin/page.tsx", "signin/staff/page.tsx", "signup/page.tsx"]

for (const file of PAGES) {
  const src = readFileSync(join(APP, file), "utf8")

  // landingFor resolves the session, confirms the account still exists, and
  // dispatches through safeLanding. Calling auth() directly here is how /signin
  // bounced a cookie for a deleted account into a guard that bounced it back.
  assert.ok(
    /await landingFor\(/.test(src),
    `${file}: must dispatch a signed-in visitor through landingFor from @/lib/landing`,
  )
  assert.ok(!/await auth\(\)/.test(src), `${file}: must not read the session itself -- use landingFor`)
  assert.ok(
    !/redirect\("\/(dashboard|admin|write|account|recruitment)"\)/.test(src),
    `${file}: redirects to a hardcoded role home -- landingFor picks one every role can reach`,
  )
}

// /go must be a page. A route handler's redirect is followed inside the client
// router's fetch on a soft navigation, leaving the address bar on /go.
assert.ok(!existsSync(join(APP, "go", "route.ts")), "go/route.ts is back: /go must be a page.tsx")

console.log(`auth page guard checks passed (${PAGES.length} doors dispatch through landingFor)`)
