// The matrix review box is plain text: one portfolio per line, "Name | Tag | Rank".
// Both sources write it (the AI draft and the spreadsheet import) and publishing reads
// it back, so these two have to be exact inverses. Pure, so
// scripts/check-portfolio-sheet.ts can pin the round trip.

export interface DraftEntry {
  name: string
  tag?: string
  priority?: number
}

export function lineFor(entry: DraftEntry): string {
  return [entry.name, entry.tag || "", entry.priority || ""].join(" | ").replace(/\s+\|\s*$/, "")
}

export function parseDraft(text: string): Array<{ name: string; tag: string; priority: number }> {
  return text.split("\n").map((line, index) => {
    const [name = "", tag = "", priority = ""] = line.split("|").map((part) => part.trim())
    return { name, tag, priority: Number(priority) || index + 1 }
  }).filter((entry) => entry.name)
}
