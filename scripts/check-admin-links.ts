#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-admin-links.ts
//
// Every /admin link in the source must point at a route that exists.
//
// The console has been reorganised twice, and both times links were left behind
// pointing at pages that had moved: the operator guide still sent people to
// /admin/config/conference and /admin/config/registration months after those
// became redirects. A redirect hides the rot rather than fixing it, and the day
// the redirect is removed the link 404s.
import assert from "node:assert"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk("src/app").filter((f) => !f.includes("/generated/"))

// A route exists if some page.tsx or route.ts sits at its path, with (groups)
// removed -- they organise files, not URLs.
const routes = new Set<string>()
for (const f of files) {
  const base = f.split("/").pop() ?? ""
  if (!/^(page\.(tsx|mdx)|route\.ts)$/.test(base)) continue
  const url = f
    .replace(/^src\/app/, "")
    .replace(/\/(page\.(tsx|mdx)|route\.ts)$/, "")
    .replace(/\/\([^)]+\)/g, "")
  routes.add(url === "" ? "/" : url)
}

// Redirect stubs are real pages and appear above, so they resolve. What must not
// happen is a link to something that is neither.
const source = files.filter((f) => /\.(ts|tsx|mdx)$/.test(f))
const offenders: string[] = []
for (const f of source) {
  const text = readFileSync(f, "utf8")
  for (const m of text.matchAll(/["'`](\/admin\/[A-Za-z0-9\-/_]*)["'`]/g)) {
    const href = m[1].replace(/\/$/, "")
    if (href.includes("${") || href.includes("[")) continue
    // Dynamic segments: /admin/mailer/<id> resolves against /admin/mailer/[id].
    const dynamic = [...routes].some((r) => {
      const pattern = new RegExp("^" + r.replace(/\[[^\]]+\]/g, "[^/]+") + "$")
      return pattern.test(href)
    })
    if (!routes.has(href) && !dynamic) offenders.push(`${f} -> ${href}`)
  }
}

assert.deepEqual(offenders, [], `admin links pointing at routes that do not exist:\n${offenders.join("\n")}`)

// The two that were actually wrong, pinned by name so a revert is caught.
for (const f of source) {
  const text = readFileSync(f, "utf8")
  if (f.includes("/docs/")) continue
  assert.doesNotMatch(text, /\/admin\/config\/conference/, `${f} links to the old conference page; society copy is /admin/site`)
  assert.doesNotMatch(text, /\/admin\/config\/registration/, `${f} links to the old registration page; the switch is /admin/config`)
}

console.log(`admin-link checks passed (${routes.size} routes, every /admin link resolves)`)
