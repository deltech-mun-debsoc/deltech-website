import { deriveCsvUrl } from "./gsheet-url"
import { parseCsvRows } from "./tabular"

// Reading a Google Sheet's CSV export, with the failure modes explained in words a
// volunteer can act on. Thrown as SheetFetchError so callers can show the message
// as-is and treat anything else as unexpected.
export class SheetFetchError extends Error {}

const SHARE_HINT = 'In Google Sheets press Share and set it to "Anyone with the link, Viewer".'

// Google sends export redirects to its dedicated spreadsheet download hosts.
function allowedDownload(url: URL): boolean {
  return url.protocol === "https:" && !url.port && !url.username && !url.password && (
    (url.hostname === "docs.google.com" && deriveCsvUrl(url.href) !== null) ||
    /^[a-z0-9-]+-sheets\.googleusercontent\.com$/.test(url.hostname) ||
    url.hostname === "docs.googleusercontent.com"
  )
}

export const MAX_SHEET_BYTES = 10 * 1024 * 1024

export async function fetchSheetText(input: string): Promise<string> {
  const canonical = deriveCsvUrl(input)
  if (!canonical) throw new SheetFetchError("Use a Google Sheets share or published link.")
  let url = new URL(canonical)
  const signal = AbortSignal.timeout(15000)
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowedDownload(url)) throw new SheetFetchError("Google Sheets redirected to an unsupported address.")
      const response = await fetch(url.href, { signal, cache: "no-store", redirect: "manual" })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get("location")
        if (!location || redirects === 5) throw new SheetFetchError("Google Sheets redirected too many times.")
        url = new URL(location, url)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new SheetFetchError(`Google refused the sheet. ${SHARE_HINT}`)
      }
      if (response.headers.get("content-type")?.includes("text/html")) {
        await response.body?.cancel()
        throw new SheetFetchError(`That sheet isn't shared. ${SHARE_HINT}`)
      }
      if (Number(response.headers.get("content-length")) > MAX_SHEET_BYTES) {
        await response.body?.cancel()
        throw new SheetFetchError("The sheet is too large. Keep CSV exports under 10 MB.")
      }
      const reader = response.body?.getReader()
      if (!reader) return ""
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_SHEET_BYTES) throw new SheetFetchError("The sheet is too large. Keep CSV exports under 10 MB.")
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return new TextDecoder().decode(bytes)
    }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new SheetFetchError("Google Sheets took too long to respond. Try again in a moment.")
    }
    throw err
  }
  throw new SheetFetchError("Google Sheets redirected too many times.")
}

export async function fetchSheetRows(
  csvUrl: string,
): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  try {
    return parseCsvRows(await fetchSheetText(csvUrl))
  } catch (error) {
    if (error instanceof SheetFetchError) throw error
    throw new SheetFetchError(error instanceof Error ? error.message : "The sheet could not be parsed.")
  }
}
