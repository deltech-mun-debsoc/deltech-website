import { read, utils } from "xlsx"

// Reading a Google Sheet's CSV export, with the failure modes explained in words a
// volunteer can act on. Thrown as SheetFetchError so callers can show the message
// as-is and treat anything else as unexpected.
export class SheetFetchError extends Error {}

const SHARE_HINT = 'In Google Sheets press Share and set it to "Anyone with the link, Viewer".'

export async function fetchSheetRows(
  csvUrl: string,
): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  let response: Response
  try {
    response = await fetch(csvUrl, { signal: AbortSignal.timeout(15000), cache: "no-store" })
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new SheetFetchError("Google Sheets took too long to respond. Try again in a moment.")
    }
    throw err
  }
  if (!response.ok) throw new SheetFetchError(`Google refused the sheet. ${SHARE_HINT}`)

  // A sheet that isn't shared does NOT fail: Google answers 200 with its sign-in
  // page, which the spreadsheet parser would happily read as one row of HTML --
  // surfacing as a baffling "missing email" on every row.
  const type = response.headers.get("content-type") ?? ""
  if (type.includes("text/html")) throw new SheetFetchError(`That sheet isn't shared. ${SHARE_HINT}`)

  const workbook = read(await response.text(), { type: "string" })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new SheetFetchError("The sheet has no readable tab.")

  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })
  const headers = rows.length > 0 ? Object.keys(rows[0]).map((h) => h.trim()) : []
  return { rows, headers }
}
