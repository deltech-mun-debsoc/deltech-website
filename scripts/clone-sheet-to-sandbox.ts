#!/usr/bin/env tsx
// Build a realistic, non-identifying import fixture from a real sheet.
//
//   npx tsx scripts/clone-sheet-to-sandbox.ts <sheet-url> [--out path] [--raw]
//
// Why this exists: interns need to exercise the import pipeline, and the only
// realistic source of import edge cases is a real form response sheet -- ragged
// columns, blank cells, duplicate submissions, unicode names, phone numbers in
// six formats. Handwritten fixtures never contain the row that actually breaks
// the parser.
//
// But a real sheet is real applicants' names, emails and phone numbers, and
// prisma/seed-staging.ts states outright: "Never copy production application
// data into staging." So this copies the SHAPE and scrubs the PEOPLE.
//
// Reading is safe by construction: this fetches the CSV export endpoint, which
// is read-only. Nothing here can write to the source sheet.
//
// The scrub is DETERMINISTIC per input value -- the same original always maps to
// the same pseudonym. That is the property that matters: a sheet where one
// person submitted twice still has two identical rows afterwards, so dedup,
// quarantine and duplicate-detection are all still exercised. Randomising would
// silently destroy the most interesting test cases.
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { read, utils } from "xlsx"
import { deriveCsvUrl } from "../src/lib/gsheet-url"

type Row = Record<string, string>

const FIRST = [
  "Aarav", "Diya", "Kabir", "Anaya", "Vihaan", "Ishani", "Arjun", "Meera",
  "Rohan", "Saanvi", "Dev", "Nikita", "Yash", "Tara", "Kunal", "Riya",
]
const LAST = [
  "Sharma", "Verma", "Nair", "Iyer", "Bose", "Chawla", "Rao", "Menon",
  "Gupta", "Reddy", "Kaur", "Bhat", "Sethi", "Dutta", "Joshi", "Malhotra",
]

/** Stable integer from a string, so one input always yields one pseudonym. */
function digest(value: string, salt: string): number {
  const hex = createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 12)
  return parseInt(hex, 16)
}

// Which columns carry a person. Matched loosely against the header text,
// because form headers are full questions ("Your full name", "WhatsApp number
// (with country code)") rather than tidy field names.
const PII: Array<{ test: RegExp; kind: "name" | "email" | "phone" }> = [
  { test: /\b(e-?mail|email address)\b/i, kind: "email" },
  { test: /\b(phone|mobile|whats-?app|contact number|number)\b/i, kind: "phone" },
  { test: /\b(name)\b/i, kind: "name" },
]

export function classify(header: string): "name" | "email" | "phone" | null {
  // Email before phone before name: "Name" appears inside "Name of parent",
  // but an email column named "Email ID" must not be caught by /number/.
  for (const { test, kind } of PII) if (test.test(header)) return kind
  return null
}

export function scrub(value: string, kind: "name" | "email" | "phone"): string {
  // A blank stays blank. Missing data is itself an edge case worth keeping:
  // it is what exercises the required-field validation.
  if (!value.trim()) return value

  const n = digest(value, kind)
  if (kind === "name") {
    // Two independent digests rather than shifting one. `n` is 48-bit and JS
    // bitwise operators coerce to 32-bit SIGNED, so `n >> 8` went negative and
    // indexed off the end of the array -- every surname came out "undefined".
    return `${FIRST[n % FIRST.length]} ${LAST[digest(value, "surname") % LAST.length]}`
  }
  if (kind === "email") {
    // A domain we own, so a stray send cannot reach a stranger.
    return `staging+${(n % 100000).toString().padStart(5, "0")}@deltechmun.in`
  }
  // Preserve the original's shape (spaces, dashes) AND its country code, then
  // replace the subscriber digits with a valid-looking Indian mobile.
  //
  // Scrambling every digit turned "+91 98765-43210" into "+90 ...", so every
  // scrubbed row failed country-code validation -- a fixture where the whole
  // sheet is invalid tests nothing.
  const digitCount = (value.match(/\d/g) ?? []).length
  const keepCc = /^\s*\+/.test(value) && digitCount > 10 ? 2 : 0
  const fake = String(9000000000 + (n % 1000000000)).slice(0, Math.max(0, digitCount - keepCc))
  let seen = 0
  let i = 0
  return value.replace(/\d/g, (d) => (seen++ < keepCc ? d : (fake[i++] ?? d)))
}

async function main() {
  const args = process.argv.slice(2)
  const raw = args.includes("--raw")
  const outIdx = args.indexOf("--out")
  const out = outIdx >= 0 ? args[outIdx + 1] : "staging-sandbox.csv"
  const source = args.find((a) => !a.startsWith("--") && a !== out)

  if (!source) {
    console.error(
      "Usage: npx tsx scripts/clone-sheet-to-sandbox.ts <sheet-url> [--out path] [--raw]\n\n" +
        "  <sheet-url>  any Google Sheets link; the CSV export is derived from it\n" +
        "  --out        where to write the CSV (default staging-sandbox.csv)\n" +
        "  --raw        do NOT scrub. Copies real names, emails and phone numbers.\n",
    )
    process.exit(1)
  }

  const csvUrl = deriveCsvUrl(source)
  if (!csvUrl) {
    console.error(`Not a Google Sheets URL: ${source}`)
    process.exit(1)
  }

  if (raw) {
    console.warn(
      "\n--raw: copying real personal data into a sandbox interns can read.\n" +
        "Only do this if you have a specific reason and will delete it after.\n",
    )
  }

  console.log(`Fetching ${csvUrl.slice(0, 60)}…`)
  const res = await fetch(csvUrl, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) {
    console.error(
      `Fetch failed: ${res.status}. The sheet must be readable by anyone with the link.`,
    )
    process.exit(1)
  }

  // Same parse path the importer itself uses, so what we emit is what it reads.
  const wb = read(await res.text(), { type: "string" })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = utils.sheet_to_json<Row>(sheet, { defval: "", raw: false })

  if (rows.length === 0) {
    console.error("Sheet has no data rows.")
    process.exit(1)
  }

  const headers = Object.keys(rows[0])
  const plan = new Map(headers.map((h) => [h, classify(h)]))
  const scrubbed = headers.filter((h) => plan.get(h))

  const outRows = raw
    ? rows
    : rows.map((row) => {
        const next: Row = {}
        // Object.keys(row) per row, not the header list: a ragged sheet has rows
        // with extra keys, and dropping them would discard the raggedness that
        // makes this fixture worth having.
        for (const key of Object.keys(row)) {
          const kind = plan.get(key) ?? classify(key)
          next[key] = kind ? scrub(String(row[key] ?? ""), kind) : String(row[key] ?? "")
        }
        return next
      })

  // Explicit header union: json_to_sheet derives columns from the FIRST row, so
  // a ragged sheet would silently lose every column that only appears later --
  // exactly the rows worth testing against.
  const allKeys = [...new Set(outRows.flatMap((r) => Object.keys(r)))]
  writeFileSync(out, utils.sheet_to_csv(utils.json_to_sheet(outRows, { header: allKeys })))

  console.log(`\nWrote ${out}`)
  console.log(`  rows:    ${outRows.length} (unchanged)`)
  console.log(`  columns: ${headers.length} (unchanged)`)
  console.log(
    raw
      ? "  scrubbed: NOTHING — this file contains real personal data"
      : `  scrubbed: ${scrubbed.length ? scrubbed.join(", ") : "(no PII columns detected — check the headers)"}`,
  )
  console.log(
    "\nNext: upload it to the sandbox spreadsheet (File → Import → Replace current sheet),\n" +
      "then point the staging import source at that sheet.",
  )
}

// Only run when invoked directly, so the check script can import the pure
// helpers without firing a network fetch.
if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
