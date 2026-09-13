// Runnable check for the docs site: npx tsx scripts/check-docs-links.ts
//
// Eighty-odd short pages that link to each other densely have exactly one
// failure mode that matters: a page gets renamed and every link to it rots
// silently, because a 404 in prose is invisible until a reader hits it.
//
// So this asserts three things:
//   1. nav.ts and the page.mdx files on disk agree, in BOTH directions;
//   2. every internal /docs link in prose resolves to a real page;
//   3. every <Screenshot src> resolves to a file that exists.
import assert from "node:assert"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { ALL_PAGES, SECTIONS } from "../src/app/(docs)/_lib/nav"

const ROOT = join(import.meta.dirname, "..")
const DOCS_DIR = join(ROOT, "src/app/(docs)/docs")
const PUBLIC_DIR = join(ROOT, "public")

// ── 1. disk and nav.ts agree ────────────────────────────────────────────────

function findPages(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findPages(full))
    else if (entry.name === "page.mdx") {
      const rel = relative(DOCS_DIR, dir).split("/").filter(Boolean)
      found.push(["/docs", ...rel].join("/"))
    }
  }
  return found
}

const onDisk = findPages(DOCS_DIR).sort()
const inNav = ALL_PAGES.map((p) => p.href).sort()

for (const href of onDisk) {
  assert.ok(
    inNav.includes(href),
    `${href} has a page.mdx but no entry in _lib/nav.ts, so it is unreachable from the sidebar, search and the pager`,
  )
}
for (const href of inNav) {
  assert.ok(
    onDisk.includes(href),
    `_lib/nav.ts lists ${href} but there is no page.mdx for it, so the sidebar links to a 404`,
  )
}

// ── 2. no duplicate hrefs, and every section has pages ──────────────────────

assert.equal(
  new Set(inNav).size,
  inNav.length,
  "duplicate href in _lib/nav.ts: neighbours() and the sidebar active state both key on href",
)
for (const section of SECTIONS) {
  assert.ok(section.pages.length > 0, `section "${section.id}" has no pages`)
  // The section's first page is what RoleCards and SectionIndex treat as its
  // landing page, so it has to be the section root rather than a child.
  assert.ok(
    section.pages[0].href.split("/").length <= 3,
    `section "${section.id}" starts at ${section.pages[0].href}, which is not a section root`,
  )
}

// ── 3. every internal link and screenshot resolves ──────────────────────────

const MD_LINK = /\]\((\/[^)\s]*)\)/g
const SCREENSHOT_SRC = /<Screenshot[^>]*\ssrc="([^"]+)"/g

// Non-docs absolute paths in prose point at the product itself (/admin/logs,
// /register). Those are real routes, not docs pages, so they are out of scope
// here; check-dead-ends.ts owns product navigation.
let checkedLinks = 0
let checkedShots = 0

for (const href of onDisk) {
  const rel = href === "/docs" ? "" : href.slice("/docs/".length)
  const file = join(DOCS_DIR, rel, "page.mdx")
  const source = readFileSync(file, "utf8")

  for (const match of source.matchAll(MD_LINK)) {
    const target = match[1].split("#")[0]
    if (!target.startsWith("/docs")) continue
    assert.ok(
      inNav.includes(target),
      `${href} links to ${target}, which is not a docs page`,
    )
    checkedLinks++
  }

  // Titles are duplicated: nav.ts drives the sidebar and the on-page heading,
  // the MDX metadata export drives the browser tab and search results. They are
  // generated together and must stay together, so pin it.
  const page = ALL_PAGES.find((p) => p.href === href)!
  const titleMatch = source.match(/^export const metadata = \{\s*\n\s*title: "((?:[^"\\]|\\.)*)"/)
  assert.ok(titleMatch, `${href} has no metadata export, so its browser title falls back to the site default`)
  assert.equal(
    titleMatch[1],
    page.label,
    `${href} metadata title disagrees with its label in _lib/nav.ts`,
  )

  for (const match of source.matchAll(SCREENSHOT_SRC)) {
    const src = match[1]
    assert.ok(src.startsWith("/"), `${href} has a relative Screenshot src: ${src}`)
    const asset = join(PUBLIC_DIR, src)
    assert.ok(
      existsSync(asset) && statSync(asset).isFile(),
      `${href} references a screenshot that does not exist: public${src}`,
    )
    checkedShots++
  }
}

console.log(
  `docs: ${onDisk.length} pages, ${checkedLinks} internal links, ${checkedShots} screenshots, all resolve`,
)
