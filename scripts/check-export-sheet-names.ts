// Regression check for the bug that took down "Export all"/"Export selected"
// on production: a cycle slug long enough to push `${prefix}-${slug}` past
// Excel's 31-character sheet name limit made XLSX.write throw on every
// request, while the CSV branch -- which never touches a sheet name -- kept
// working. That asymmetry is exactly why it went unnoticed: nobody's manual
// check ever tried the XLSX button with a real, long-slugged cycle.
//
// This exercises the REAL xlsx library, not just the string helper: a
// regex match on `safeSheetName` proves nothing about whether XLSX.write
// actually accepts what comes out of it.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import * as XLSX from "xlsx"
import { safeSheetName } from "../src/app/api/admin/export/route"

function bookAppendSucceeds(name: string): boolean {
  try {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet([{ a: 1 }])
    XLSX.utils.book_append_sheet(wb, ws, name)
    XLSX.write(wb, { type: "base64", bookType: "xlsx" })
    return true
  } catch {
    return false
  }
}

// The exact production shape that crashed: a real cycle slug plus either
// export prefix, both past 31 chars once combined.
const REAL_SLUG = "deltech-recruitement-2026"
for (const prefix of ["candidates", "selected"]) {
  const raw = `${prefix}-${REAL_SLUG}`
  assert.ok(raw.length > 31, "test setup: this name must actually be over the limit")
  assert.ok(bookAppendSucceeds(safeSheetName(raw)), `safeSheetName(${JSON.stringify(raw)}) must be XLSX-writable`)
}

// cycleSlugSchema allows up to 60 chars -- the longest a slug can legally be.
const MAX_SLUG = "a".repeat(60)
for (const prefix of ["candidates", "selected"]) {
  const raw = `${prefix}-${MAX_SLUG}`
  assert.ok(bookAppendSucceeds(safeSheetName(raw)), "a maximum-length slug must still produce a writable sheet name")
}

// A name already forbidden-character-free and under the limit must survive
// unchanged -- this is a truncate-and-strip function, not a rewrite.
assert.equal(safeSheetName("candidates-short-cycle"), "candidates-short-cycle")

// Forbidden characters (Excel: : \ / ? * [ ]) are stripped, not merely
// tolerated by luck of the regex.
assert.ok(bookAppendSucceeds(safeSheetName("weird:name/with*forbidden[chars]")))
assert.doesNotMatch(safeSheetName("weird:name/with*forbidden[chars]"), /[:\\/?*[\]]/)

// An empty or all-forbidden name must not produce an empty sheet name --
// XLSX rejects that too.
assert.ok(bookAppendSucceeds(safeSheetName("")))
assert.ok(bookAppendSucceeds(safeSheetName(":::")))

// The real call site must route through the guard, or a future edit could
// reintroduce the raw name and silently drop this protection.
{
  const src = readFileSync("src/app/api/admin/export/route.ts", "utf8")
  assert.match(
    src,
    /XLSX\.utils\.book_append_sheet\(wb, ws, safeSheetName\(name\)\)/,
    "the candidate/matrix XLSX sheet must be registered through safeSheetName, not the raw name",
  )
}

console.log("✅ check-export-sheet-names passed (candidates, selected, max-length slug, forbidden chars)")
