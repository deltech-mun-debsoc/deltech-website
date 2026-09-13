// Turn a portfolio-matrix spreadsheet tab into portfolio entries. Pure, so
// scripts/check-portfolio-sheet.ts can pin it.
//
// The society keeps its matrix as one Google Sheet tab per committee:
//   UNSC:  S.No | Portfolio | Allotments
//   AIPPM: S.No | Portfolio | Party | Allotment
// Rather than asking a volunteer to reformat that into "Name | Tag | Rank" lines,
// this finds the name column and the tag column itself, keeps the sheet's order as
// the rank, and tidies the small slips that creep into a hand-typed list.

export interface PortfolioEntry {
  name: string
  tag?: string
  priority: number
}

export interface PortfolioSheetResult {
  entries: PortfolioEntry[]
  nameColumn: string | null
  tagColumn: string | null
  // Rows whose allotment column is filled in: seats already given out by hand in
  // the sheet, which the platform does not yet know about.
  alreadyAllotted: number
  duplicates: number
}

const NAME_HEADER = /^(portfolios?|countr(y|ies)|names?|delegations?|members?|seats?|roles?)$/i
const TAG_HEADER = /^(party|parties|tags?|blocs?|affiliation|member ?status|type|category)$/i
const SERIAL_HEADER = /^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|serial|#|no\.?)$/i
const ALLOT_HEADER = /allot/i

// Words that stay lowercase inside a title: "Democratic Republic of Congo".
const SMALL = new Set(["of", "and", "the", "de", "du", "la", "le", "da", "del", "von", "van", "al"])

// Tidy one name. Only an ALL-lowercase name is re-cased ("egypt" -> "Egypt"):
// anything with capitals was typed deliberately, and "McDonald" or "UAE" must not
// be flattened into "Mcdonald" or "Uae".
export function cleanPortfolioName(raw: unknown): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim()
  if (!name || name !== name.toLowerCase()) return name
  return name
    .split(" ")
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
}

export function portfoliosFromSheetRows(rows: Record<string, unknown>[]): PortfolioSheetResult {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  const trimmed = (h: string) => h.trim()

  const nameColumn =
    headers.find((h) => NAME_HEADER.test(trimmed(h))) ??
    // No recognisable header: the first column that isn't a serial number or an
    // allotment column is, in practice, the names.
    headers.find((h) => !SERIAL_HEADER.test(trimmed(h)) && !ALLOT_HEADER.test(trimmed(h)) && !TAG_HEADER.test(trimmed(h))) ??
    null
  const tagColumn = headers.find((h) => h !== nameColumn && TAG_HEADER.test(trimmed(h))) ?? null
  const allotColumn = headers.find((h) => ALLOT_HEADER.test(trimmed(h))) ?? null

  const entries: PortfolioEntry[] = []
  const seen = new Set<string>()
  let alreadyAllotted = 0
  let duplicates = 0

  if (!nameColumn) return { entries, nameColumn, tagColumn, alreadyAllotted, duplicates }

  for (const row of rows) {
    const name = cleanPortfolioName(row[nameColumn])
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    if (allotColumn && String(row[allotColumn] ?? "").trim()) alreadyAllotted++
    const tag = tagColumn ? cleanPortfolioName(row[tagColumn]) : ""
    // Sheet order is the rank: the matrix was written in the order it was meant.
    entries.push({ name, ...(tag ? { tag } : {}), priority: entries.length + 1 })
  }

  return { entries, nameColumn: nameColumn.trim(), tagColumn: tagColumn?.trim() ?? null, alreadyAllotted, duplicates }
}
