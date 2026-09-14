#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-admin-nav.ts
//
// The event is one place in the sidebar, with one tab bar across every event
// page. These pin that each console page highlights exactly one sidebar item and
// one tab, and that no event page is left out of the workspace.
import assert from "node:assert"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { EVENT_PATHS, NAV_GROUPS, activeHref, isNavActive } from "../src/app/(admin)/_components/admin-nav"
import { DELEGATE_SECTIONS, EVENT_TABS } from "../src/app/(admin)/admin/(event)/_lib/event-tabs"

const items = NAV_GROUPS.flatMap((g) => g.items)
const hrefs = items.map((i) => i.href)
assert.equal(new Set(hrefs).size, hrefs.length, "no page appears twice in the sidebar")

const sidebar: [string, string | null][] = [
  ["/admin", "/admin"],
  ["/admin/config/committees", "/admin"],
  ["/admin/registrations", "/admin"],
  ["/admin/form-responses", "/admin"],
  ["/admin/import", "/admin"],
  ["/admin/participants", "/admin"],
  ["/admin/allotment", "/admin"],
  ["/admin/mailer/ck123", "/admin"],
  ["/admin/checkin/some-token", "/admin"],
  ["/admin/outreach/contacts", "/admin/outreach"],
  ["/admin/quiz/ck123/results", "/admin/quiz"],
  ["/admin/registrations-old", null],
]
for (const [path, want] of sidebar) {
  const active = hrefs.filter((h) => isNavActive(path, h))
  assert.deepEqual(active, want ? [want] : [], `${path} should highlight ${want ?? "nothing"}, got ${active}`)
}

const tabs: [string, string][] = [
  ["/admin", "/admin"],
  ["/admin/config/money", "/admin/config"],
  ["/admin/form-responses", "/admin/registrations"],
  ["/admin/participants", "/admin/registrations"],
  ["/admin/mailer/new", "/admin/mailer"],
  ["/admin/checkin/some-token", "/admin/checkin"],
]
for (const [path, want] of tabs) assert.equal(activeHref(path, EVENT_TABS), want, `${path} belongs to the ${want} tab`)
assert.equal(activeHref("/admin/import", DELEGATE_SECTIONS), "/admin/import")

// The sidebar's list of event pages, the tab bar and the route group agree.
const tabPaths = EVENT_TABS.flatMap((t) => [t.href, ...(t.match ?? [])]).filter((p) => p !== "/admin")
assert.deepEqual([...tabPaths].sort(), [...EVENT_PATHS].sort(), "every event page is in both the sidebar entry and a tab")
const groupDir = "src/app/(admin)/admin/(event)"
for (const name of readdirSync(groupDir)) {
  if (name.startsWith("_") || !statSync(`${groupDir}/${name}`).isDirectory()) continue
  assert.ok(EVENT_PATHS.includes(`/admin/${name}`), `/admin/${name} lives in the event workspace but has no tab`)
}

const outreach = readFileSync("src/app/(admin)/admin/outreach/layout.tsx", "utf8")
for (const tab of ["/admin/outreach", "/admin/outreach/new", "/admin/outreach/contacts"]) {
  assert.ok(outreach.includes(`"${tab}"`), `every outreach page carries the ${tab} tab`)
}

console.log("check-admin-nav: ok")
