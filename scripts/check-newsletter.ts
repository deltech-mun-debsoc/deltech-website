import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

import { ARTICLES, ISSUE, type Block } from "../src/content/newsletter/issue-01"

const ROOT = join(import.meta.dirname, "..")
const SKIP_KEYS = new Set(["type", "src", "alt", "icon", "tone", "rule", "widths", "slug", "page", "style", "logo", "logoAlt"])

function words(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
}

function collect(value: unknown, out: string[]) {
  if (typeof value === "string") out.push(...words(value.replace(/\*\*|\*|\[\[|\]\]/g, "")))
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out))
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) collect(v, out)
}

function chrome(blocks: Block[], out: string[]) {
  for (const b of blocks) {
    if (b.type === "learned") out.push(...words("What we learned 01 02 03"))
    if (b.type === "row") b.cols.forEach((c) => chrome(c, out))
  }
}

function diff(expected: string[], actual: string[]) {
  const counts = new Map<string, number>()
  for (const w of expected) counts.set(w, (counts.get(w) ?? 0) + 1)
  for (const w of actual) counts.set(w, (counts.get(w) ?? 0) - 1)
  const missing: string[] = []
  const extra: string[] = []
  for (const [w, n] of counts) {
    if (n > 0) missing.push(`${w}×${n}`)
    if (n < 0) extra.push(`${w}×${-n}`)
  }
  return { missing, extra }
}

const failures: string[] = []

const pages: { page: number; data: unknown; extra: string[] }[] = [
  ...ARTICLES.map((a) => {
    const extra = words("EXPLAINED")
    chrome(a.blocks, extra)
    return { page: a.page, data: a, extra }
  }),
  { page: ISSUE.note.page, data: ISSUE.note, extra: [] },
]

for (const { page, data, extra } of pages) {
  const expected = words(readFileSync(join(ROOT, `scripts/fixtures/newsletter/p${page}.txt`), "utf8"))
  const actual = [...extra]
  collect(data, actual)
  const { missing, extra: added } = diff(expected, actual)
  if (missing.length) failures.push(`page ${page}: missing from site ${missing.join(" ")}`)
  if (added.length) failures.push(`page ${page}: not in PDF ${added.join(" ")}`)
}

const assets = [
  ISSUE.pdf,
  ISSUE.cover.thumb,
  ISSUE.cover.cartoons,
  ISSUE.note.logo,
  ...[1, 2, 3, 4, 5, 6, 7].map(ISSUE.pageImage),
  ...ARTICLES.flatMap((a) =>
    a.blocks.flatMap(function srcs(b: Block): string[] {
      if (b.type === "figure") return [b.src]
      if (b.type === "row") return b.cols.flat().flatMap(srcs)
      return []
    }),
  ),
]
for (const a of assets) if (!existsSync(join(ROOT, "public", a))) failures.push(`missing asset public${a}`)

if (failures.length) {
  console.error("check-newsletter failed:\n" + failures.join("\n"))
  process.exit(1)
}
console.log(`check-newsletter: ${pages.length} pages match the PDF text layer, ${assets.length} assets present`)
