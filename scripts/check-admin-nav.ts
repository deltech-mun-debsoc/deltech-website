#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-admin-nav.ts
//
// Exactly one sidebar item is highlighted for any console page. Prefix matching
// used to light up Event control and Committees & matrix together, and the
// Mailer's contacts page had no way back to writing mail.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { NAV_GROUPS, isNavActive, longestMatch } from "../src/app/(admin)/_components/admin-nav"

const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))
assert.equal(new Set(hrefs).size, hrefs.length, "no page appears twice in the sidebar")

const cases: [string, string | null][] = [
  ["/admin", "/admin"],
  ["/admin/config", "/admin/config"],
  ["/admin/config/committees", "/admin/config/committees"],
  ["/admin/config/money", "/admin/config"],
  ["/admin/mailer/contacts", "/admin/mailer"],
  ["/admin/quiz/ck123/results", "/admin/quiz"],
  ["/admin/registrations-old", null],
]
for (const [path, want] of cases) {
  const active = hrefs.filter((h) => isNavActive(path, h))
  assert.deepEqual(active, want ? [want] : [], `${path} should highlight ${want ?? "nothing"}, got ${active}`)
}

const mailerTabs = ["/admin/mailer", "/admin/mailer/new", "/admin/mailer/contacts"]
assert.equal(longestMatch("/admin/mailer/new", mailerTabs), "/admin/mailer/new")
assert.equal(longestMatch("/admin/mailer/ck123", mailerTabs), "/admin/mailer", "a campaign page belongs to All mail")

const layout = readFileSync("src/app/(admin)/admin/mailer/layout.tsx", "utf8")
for (const tab of mailerTabs) assert.ok(layout.includes(`"${tab}"`), `every mailer page carries the ${tab} tab`)

console.log("check-admin-nav: ok")
