import { parse } from "csv-parse/sync"
import { stringify } from "csv-stringify/sync"

export const MAX_TABULAR_ROWS = 10_000
export const MAX_TABULAR_COLUMNS = 250

// Spreadsheet programs execute cells beginning with these characters as formulas.
// Exported names, phone numbers, and other user-controlled text must remain data.
export function safeSpreadsheetCell(value: string | number): string | number {
  return typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value
}

export function parseCsvRows(csv: string): { rows: Record<string, unknown>[]; headers: string[] } {
  const records = parse(csv, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    max_record_size: 1_000_000,
  }) as string[][]
  if (records.length === 0) return { rows: [], headers: [] }
  if (records.length - 1 > MAX_TABULAR_ROWS) throw new Error(`The file has more than ${MAX_TABULAR_ROWS} data rows.`)
  if (records[0].length > MAX_TABULAR_COLUMNS) throw new Error(`The file has more than ${MAX_TABULAR_COLUMNS} columns.`)
  const headers = records[0].map((header) => String(header ?? "").trim())
  const rows = records.slice(1).map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, String(record[index] ?? "").trim()])),
  )
  return { rows, headers }
}

export function stringifyRows(rows: Record<string, string | number>[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const safeRows = rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeSpreadsheetCell(value)])),
  )
  return stringify(safeRows, { header: true, columns: headers, bom: true })
}
