// Runnable check for the Google Sheets URL parser: npx tsx scripts/check-gsheet-url.ts
import assert from "node:assert"
import { deriveCsvUrl } from "../src/lib/gsheet-url"

// share/edit link with gid
assert.equal(
  deriveCsvUrl("https://docs.google.com/spreadsheets/d/1AbC_dEf/edit#gid=42"),
  "https://docs.google.com/spreadsheets/d/1AbC_dEf/export?format=csv&gid=42",
)
// edit link, no gid → defaults to 0
assert.equal(
  deriveCsvUrl("https://docs.google.com/spreadsheets/d/1AbC_dEf/edit?usp=sharing"),
  "https://docs.google.com/spreadsheets/d/1AbC_dEf/export?format=csv&gid=0",
)
// ?gid= form
assert.equal(
  deriveCsvUrl("https://docs.google.com/spreadsheets/d/1AbC_dEf/edit?gid=7#gid=7"),
  "https://docs.google.com/spreadsheets/d/1AbC_dEf/export?format=csv&gid=7",
)
// published-to-web pubhtml → pub?output=csv
assert.equal(
  deriveCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pubhtml"),
  "https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pub?output=csv",
)
// already CSV → passthrough
const csv = "https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pub?output=csv"
assert.equal(deriveCsvUrl(csv), csv)
// export URL already → passthrough
const exp = "https://docs.google.com/spreadsheets/d/1AbC_dEf/export?format=csv&gid=3"
assert.equal(deriveCsvUrl(exp), exp)
// junk
assert.equal(deriveCsvUrl("https://example.com/nope"), null)
assert.equal(deriveCsvUrl("  "), null)
// A former passthrough accepted any URL with this query and fed it to server fetch.
assert.equal(deriveCsvUrl("http://169.254.169.254/latest/meta-data?format=csv"), null)
assert.equal(deriveCsvUrl("https://evil.example/?output=csv"), null)
assert.equal(deriveCsvUrl("https://docs.google.com.evil.example/spreadsheets/d/x/edit"), null)
assert.equal(deriveCsvUrl("https://user@docs.google.com/spreadsheets/d/x/edit"), null)
assert.equal(deriveCsvUrl("https://docs.google.com:444/spreadsheets/d/x/edit"), null)
assert.equal(deriveCsvUrl("https://docs.google.com/spreadsheets/d/x/edit?gid=not-a-number"), null)

console.log("gsheet-url checks passed")
