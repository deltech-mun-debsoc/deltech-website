#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-portfolio-sheet.ts
//
// Loading a committee's matrix from the society's own spreadsheet. The two tab
// shapes below are the real ones from the Intra MUN portfolio matrix.
import assert from "node:assert"
import { cleanPortfolioName, portfoliosFromSheetRows } from "../src/lib/portfolio-sheet"

// ── UNSC tab: S.No | Portfolio | Allotments ─────────────────────────────────
{
  const r = portfoliosFromSheetRows([
    { "S.No": "1", Portfolio: "Afghanistan", Allotments: "" },
    { "S.No": "2", Portfolio: "Côte d’Ivoire", Allotments: "" },
    { "S.No": "3", Portfolio: "egypt", Allotments: "Somebody" },
    { "S.No": "4", Portfolio: "Democratic Republic of Congo", Allotments: "" },
  ])
  assert.equal(r.nameColumn, "Portfolio", "the Portfolio column must be found by its header")
  assert.equal(r.tagColumn, null, "UNSC has no tag column")
  assert.deepEqual(
    r.entries.map((e) => e.name),
    ["Afghanistan", "Côte d’Ivoire", "Egypt", "Democratic Republic of Congo"],
    "names come through, with the lowercase slip fixed and everything else left alone",
  )
  assert.deepEqual(r.entries.map((e) => e.priority), [1, 2, 3, 4], "sheet order is the rank")
  assert.equal(r.alreadyAllotted, 1, "a filled Allotments cell must be counted, so the organiser is told")
}

// ── AIPPM tab: S.No | Portfolio | Party | Allotment (with a trailing space) ──
{
  const r = portfoliosFromSheetRows([
    { "S.No": "1", Portfolio: "Asaduddin Owaisi", Party: "All India Majlis-e-Ittehadul Muslimeen", Allotment: "" },
    { "S.No": "2", Portfolio: "Gajendra Singh Khimsar ", Party: "BJP", Allotment: "" },
  ])
  assert.equal(r.tagColumn, "Party", "the party must become the tag")
  assert.equal(r.entries[0].tag, "All India Majlis-e-Ittehadul Muslimeen")
  assert.equal(r.entries[1].name, "Gajendra Singh Khimsar", "a trailing space must not become part of the name")
}

// ── Messy sheets ────────────────────────────────────────────────────────────
{
  const r = portfoliosFromSheetRows([
    { Portfolio: "India" },
    { Portfolio: "" },
    { Portfolio: "INDIA" },
    { Portfolio: "  india  " },
    { Portfolio: "France" },
  ])
  assert.deepEqual(r.entries.map((e) => e.name), ["India", "France"], "blank rows skip; a repeated name is added once")
  assert.equal(r.duplicates, 2)

  const noHeader = portfoliosFromSheetRows([{ "Sr. No.": "1", Delegate: "Japan" }])
  assert.equal(noHeader.nameColumn, "Delegate", "with no recognisable header, the first non-serial column is the names")

  assert.equal(portfoliosFromSheetRows([]).nameColumn, null, "an empty sheet finds nothing, rather than guessing")
}

// ── Name tidying only touches what was clearly a slip ───────────────────────
{
  assert.equal(cleanPortfolioName("egypt"), "Egypt")
  assert.equal(cleanPortfolioName("united states of america"), "United States of America")
  assert.equal(cleanPortfolioName("UAE"), "UAE", "deliberate capitals must survive")
  assert.equal(cleanPortfolioName("McDonald"), "McDonald")
  assert.equal(cleanPortfolioName("  Saudi   Arabia "), "Saudi Arabia")
}

console.log("portfolio sheet checks passed (UNSC and AIPPM tab shapes, ranking, tidying, duplicates)")
