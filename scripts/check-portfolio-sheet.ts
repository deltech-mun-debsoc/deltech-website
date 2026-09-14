#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-portfolio-sheet.ts
//
// Loading a committee's matrix from the society's own spreadsheet. The two tab
// shapes below are the real ones from the Intra MUN portfolio matrix.
import assert from "node:assert"
import { cleanPortfolioName, portfoliosFromSheetRows } from "../src/lib/portfolio-sheet"
import { lineFor, parseDraft } from "../src/app/(admin)/admin/(event)/config/_lib/draft-lines"

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

// ── The seam: what the sheet produces must survive the review box ──────────
// The import writes the draft as text and publishing parses it back, so lineFor
// and parseDraft have to be exact inverses. If they drift, the matrix silently
// publishes wrong ranks or loses tags, with nothing to catch it.
{
  const sheet = portfoliosFromSheetRows([
    { "S.No": "1", Portfolio: "india", Party: "BJP", Allotment: "" },
    { "S.No": "2", Portfolio: "united states of america", Party: "", Allotment: "" },
    { "S.No": "3", Portfolio: "UAE", Party: "Observer", Allotment: "" },
  ])
  const republished = parseDraft(sheet.entries.map(lineFor).join("\n"))

  assert.deepEqual(
    republished,
    [
      { name: "India", tag: "BJP", priority: 1 },
      { name: "United States of America", tag: "", priority: 2 },
      { name: "UAE", tag: "Observer", priority: 3 },
    ],
    "a sheet survives the round trip through the review box with ranks and tags intact",
  )

  // A portfolio with no tag must not shift its rank into the tag column.
  assert.equal(lineFor({ name: "Japan", priority: 4 }), "Japan |  | 4")
  assert.deepEqual(parseDraft("Japan |  | 4"), [{ name: "Japan", tag: "", priority: 4 }])

  // An volunteer editing the box by hand rarely types ranks. Order must then win.
  assert.deepEqual(
    parseDraft("Brazil\nChile"),
    [{ name: "Brazil", tag: "", priority: 1 }, { name: "Chile", tag: "", priority: 2 }],
    "unranked hand-typed lines fall back to their order, never to rank 0",
  )
}

console.log("portfolio sheet checks passed (UNSC and AIPPM tab shapes, ranking, tidying, duplicates, review-box round trip)")
