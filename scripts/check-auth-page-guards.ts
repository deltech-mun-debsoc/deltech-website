// Runnable check: npx tsx scripts/check-auth-page-guards.ts
//
// The auth pages are doors, not destinations. /signin, /signin/staff and
// /signup all rendered their form unconditionally, so a signed-in visitor got
// a login screen that reads as "you are logged out" with no way forward but to
// authenticate a second time. /signup did guard, but redirected to a hardcoded
// /dashboard -- the REGISTERER home -- so a signed-in admin was sent to a page
// their role has no business on and bounced again.
//
// Both failures are the same shape: a destination decided locally instead of by
// roleHome/safeLanding, which is what /go already routes every sign-in through.
// This pins the guard AND the fact that it dispatches by role.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const APP = join(__dirname, "..", "src", "app", "(public)")

const PAGES = [
  { file: "signin/page.tsx", dispatcher: "safeLanding" },
  { file: "signin/staff/page.tsx", dispatcher: "safeLanding" },
  // No callbackUrl to honour here, so the role's home is the whole answer.
  { file: "signup/page.tsx", dispatcher: "roleHome" },
]

for (const { file, dispatcher } of PAGES) {
  const src = readFileSync(join(APP, file), "utf8")

  assert.ok(
    /await auth\(\)/.test(src),
    `${file}: must call auth() -- a signed-in visitor should never be shown a sign-in form`,
  )
  assert.ok(
    /if \(session\)/.test(src),
    `${file}: must redirect when a session exists`,
  )
  assert.ok(
    src.includes(dispatcher),
    `${file}: must dispatch through ${dispatcher} from @/lib/nav, not a hardcoded path`,
  )
  // The specific regression: /signup used to send everyone to the REGISTERER
  // home regardless of role.
  assert.ok(
    !/redirect\("\/(dashboard|admin|write|account|recruitment)"\)/.test(src),
    `${file}: redirects to a hardcoded role home -- use ${dispatcher} so every role lands somewhere it can actually reach`,
  )
}

console.log(`auth page guard checks passed (${PAGES.length} doors dispatch by role)`)
