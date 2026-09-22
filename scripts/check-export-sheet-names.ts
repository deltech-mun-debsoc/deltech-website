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
import ExcelJS from "exceljs"
import { safeSheetName } from "../src/app/api/admin/export/route"
import { parseCsvRows, safeSpreadsheetCell, stringifyRows } from "../src/lib/tabular"

async function bookAppendSucceeds(name: string): Promise<boolean> {
  try {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet(name).addRow(["a", 1])
    await wb.xlsx.writeBuffer()
    return true
  } catch {
    return false
  }
}

// The exact production shape that crashed: a real cycle slug plus either
// export prefix, both past 31 chars once combined.
async function main() {
const REAL_SLUG = "deltech-recruitement-2026"

// Applicant-controlled fields must not become formulas when staff open exports.
for (const dangerous of ["=HYPERLINK(\"https://evil.example\")", "+91 99999 99999", " -2+3", "@SUM(A1:A2)"]) {
  assert.equal(safeSpreadsheetCell(dangerous), `'${dangerous}`)
  assert.equal(parseCsvRows(stringifyRows([{ Name: dangerous }])).rows[0]?.Name, `'${dangerous}`)
}
assert.equal(safeSpreadsheetCell("ordinary text"), "ordinary text")
assert.equal(safeSpreadsheetCell(-42), -42)

for (const prefix of ["candidates", "selected"]) {
  const raw = `${prefix}-${REAL_SLUG}`
  assert.ok(raw.length > 31, "test setup: this name must actually be over the limit")
  assert.ok(await bookAppendSucceeds(safeSheetName(raw)), `safeSheetName(${JSON.stringify(raw)}) must be XLSX-writable`)
}

// cycleSlugSchema allows up to 60 chars -- the longest a slug can legally be.
const MAX_SLUG = "a".repeat(60)
for (const prefix of ["candidates", "selected"]) {
  const raw = `${prefix}-${MAX_SLUG}`
  assert.ok(await bookAppendSucceeds(safeSheetName(raw)), "a maximum-length slug must still produce a writable sheet name")
}

// A name already forbidden-character-free and under the limit must survive
// unchanged -- this is a truncate-and-strip function, not a rewrite.
assert.equal(safeSheetName("candidates-short-cycle"), "candidates-short-cycle")

// Forbidden characters (Excel: : \ / ? * [ ]) are stripped, not merely
// tolerated by luck of the regex.
assert.ok(await bookAppendSucceeds(safeSheetName("weird:name/with*forbidden[chars]")))
assert.doesNotMatch(safeSheetName("weird:name/with*forbidden[chars]"), /[:\\/?*[\]]/)

// An empty or all-forbidden name must not produce an empty sheet name --
// XLSX rejects that too.
assert.ok(await bookAppendSucceeds(safeSheetName("")))
assert.ok(await bookAppendSucceeds(safeSheetName(":::")))

// The real call site must route through the guard, or a future edit could
// reintroduce the raw name and silently drop this protection.
{
  const src = readFileSync("src/app/api/admin/export/route.ts", "utf8")
  assert.match(
    src,
    /wb\.addWorksheet\(safeSheetName\(name\)\)/,
    "the candidate/matrix XLSX sheet must be registered through safeSheetName, not the raw name",
  )
}

console.log("✅ check-export-sheet-names passed (candidates, selected, max-length slug, forbidden chars)")
}

main().catch((error) => { console.error(error); process.exit(1) })
