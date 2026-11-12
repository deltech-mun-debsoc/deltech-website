import { createSign } from "node:crypto"
import { deriveCsvUrl } from "./gsheet-url"
import { parseCsvRows } from "./tabular"

// Reading a Google Sheet's CSV export, with the failure modes explained in words a
// volunteer can act on. Thrown as SheetFetchError so callers can show the message
// as-is and treat anything else as unexpected.
export class SheetFetchError extends Error {}

// The address staff share a sheet with so it can be read without making it
// public, or null when no service account is configured.
export function sheetBotEmail(): string | null {
  return process.env.GOOGLE_SA_EMAIL?.trim() || null
}

function shareHint(): string {
  const bot = sheetBotEmail()
  return bot
    ? `In Google Sheets press Share and add ${bot} as a Viewer.`
    : 'In Google Sheets press Share and set it to "Anyone with the link, Viewer".'
}

// Google sends export redirects to its dedicated spreadsheet download hosts.
function allowedDownload(url: URL): boolean {
  return url.protocol === "https:" && !url.port && !url.username && !url.password && (
    (url.hostname === "docs.google.com" && deriveCsvUrl(url.href) !== null) ||
    /^[a-z0-9-]+-sheets\.googleusercontent\.com$/.test(url.hostname) ||
    url.hostname === "docs.googleusercontent.com"
  )
}

export const MAX_SHEET_BYTES = 10 * 1024 * 1024

// `bearer` is a service-account token. It is only ever sent to the Google hosts
// allowedDownload accepts, on every hop of the redirect chain.
export async function fetchSheetText(input: string, bearer?: string): Promise<string> {
  const canonical = deriveCsvUrl(input)
  if (!canonical) throw new SheetFetchError("Use a Google Sheets share or published link.")
  let url = new URL(canonical)
  const signal = AbortSignal.timeout(15000)
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowedDownload(url)) throw new SheetFetchError("Google Sheets redirected to an unsupported address.")
      const response = await fetch(url.href, {
        signal,
        cache: "no-store",
        redirect: "manual",
        ...(bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {}),
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get("location")
        if (!location || redirects === 5) throw new SheetFetchError("Google Sheets redirected too many times.")
        url = new URL(location, url)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new SheetFetchError(`Google refused the sheet. ${shareHint()}`)
      }
      if (response.headers.get("content-type")?.includes("text/html")) {
        await response.body?.cancel()
        throw new SheetFetchError(`That sheet isn't shared. ${shareHint()}`)
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

// ---------------------------------------------------------------------------
// Private access through a Google service account
// ---------------------------------------------------------------------------
//
// A response sheet holds names, phones and roll numbers. Reading it through
// "anyone with the link" makes all of that public to whoever has the link. With
// GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY set, staff can instead share the
// sheet with that one address as a Viewer, and the export is fetched with the
// service account's token.
//
// The anonymous read is tried FIRST, on purpose. A sheet open to anyone with the
// link is also readable with the token, so trying the token first would report
// an exposed sheet as private. "public" therefore means exactly "a stranger with
// the link can read this", which is what the screen warns about.

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const SCOPE = "https://www.googleapis.com/auth/drive.readonly"

let cachedToken: { token: string; expiresAt: number; email: string } | null = null

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url")

export async function serviceAccountToken(now: number = Date.now()): Promise<string | null> {
  const email = sheetBotEmail()
  // Secrets stores keep the PEM on one line with literal \n.
  const key = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (!email || !key) return null
  if (cachedToken && cachedToken.email === email && cachedToken.expiresAt - 60_000 > now) return cachedToken.token

  const iat = Math.floor(now / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
  )}`
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key)
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Google refused the service account (${response.status}).`)
  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error("Google returned no access token for the service account.")
  cachedToken = { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000, email }
  return body.access_token
}

export type SheetAccess = "private" | "public"

export async function fetchSheetRows(
  csvUrl: string,
): Promise<{ rows: Record<string, unknown>[]; headers: string[]; access: SheetAccess }> {
  const parse = (text: string) => {
    try {
      return parseCsvRows(text)
    } catch (error) {
      throw new SheetFetchError(error instanceof Error ? error.message : "The sheet could not be parsed.")
    }
  }

  let publicFailure: SheetFetchError
  try {
    return { ...parse(await fetchSheetText(csvUrl)), access: "public" }
  } catch (error) {
    if (!(error instanceof SheetFetchError)) throw error
    publicFailure = error
  }

  // A published-to-web link is public by construction; a token adds nothing.
  if (deriveCsvUrl(csvUrl)?.includes("/spreadsheets/d/e/")) throw publicFailure
  let token: string | null = null
  try {
    token = await serviceAccountToken()
  } catch (error) {
    console.error("[sheet-fetch] service account:", error instanceof Error ? error.message : error)
  }
  if (!token) throw publicFailure
  return { ...parse(await fetchSheetText(csvUrl, token)), access: "private" }
}
