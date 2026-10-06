#!/usr/bin/env tsx
import assert from "node:assert/strict"
import { createVerify, generateKeyPairSync } from "node:crypto"
import { fetchSheetRows, fetchSheetText, MAX_SHEET_BYTES, SheetFetchError } from "../src/lib/sheet-fetch"

const originalFetch = globalThis.fetch
const input = "https://docs.google.com/spreadsheets/d/test/edit#gid=0"

async function rejectsWith(responses: Response[], pattern: RegExp) {
  let calls = 0
  globalThis.fetch = (async () => responses[calls++]!) as typeof fetch
  await assert.rejects(fetchSheetText(input), (error: unknown) =>
    error instanceof SheetFetchError && pattern.test(error.message))
}

async function main() {
try {
  await rejectsWith([
    new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
  ], /unsupported address/)

  await rejectsWith([
    new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html" } }),
  ], /isn't shared/)

  await rejectsWith([
    new Response("x", { status: 200, headers: { "content-length": String(MAX_SHEET_BYTES + 1) } }),
  ], /too large/)

  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_SHEET_BYTES))
      controller.enqueue(new Uint8Array(1))
      controller.close()
    },
  })
  await rejectsWith([new Response(oversized)], /too large/)

  let calls = 0
  globalThis.fetch = (async (url) => {
    calls++
    if (calls === 1) {
      assert.match(String(url), /^https:\/\/docs\.google\.com\/spreadsheets\/d\/test\/export/)
      return new Response(null, {
        status: 302,
        headers: { location: "https://doc-0o-00-sheets.googleusercontent.com/export.csv" },
      })
    }
    assert.equal(String(url), "https://doc-0o-00-sheets.googleusercontent.com/export.csv")
    return new Response("email,name\na@example.com,A")
  }) as typeof fetch
  assert.equal(await fetchSheetText(input), "email,name\na@example.com,A")
  assert.equal(calls, 2)

  // --- Private access through the service account ---------------------------
  // The anonymous read goes first, so "public" means a stranger with the link
  // can read it. Only when that fails is the token minted and used, and it is
  // only ever sent to Google's sheet hosts, never along a redirect elsewhere.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  process.env.GOOGLE_SA_EMAIL = "bot@project.iam.gserviceaccount.com"
  process.env.GOOGLE_SA_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n")

  const seen: { url: string; auth: string | null; body?: string }[] = []
  const record = (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    seen.push({ url: String(url), auth: headers.get("authorization"), body: typeof init?.body === "string" ? init.body : init?.body?.toString() })
  }

  // Public sheet: read anonymously, reported public, no token minted.
  seen.length = 0
  globalThis.fetch = (async (url, init) => {
    record(url, init)
    return new Response("email,name\na@example.com,A")
  }) as typeof fetch
  const open = await fetchSheetRows(input)
  assert.equal(open.access, "public", "a sheet anyone with the link can read is public, whatever else could read it")
  assert.equal(seen.length, 1)
  assert.equal(seen[0].auth, null)

  // Private sheet: the anonymous read is bounced to Google sign-in, then the
  // token is minted and sent only to the sheet hosts.
  seen.length = 0
  globalThis.fetch = (async (url, init) => {
    record(url, init)
    const href = String(url)
    const auth = new Headers(init?.headers).get("authorization")
    if (href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "tok-123", expires_in: 3600 })
    }
    if (!auth) return new Response(null, { status: 302, headers: { location: "https://accounts.google.com/ServiceLogin" } })
    if (href.startsWith("https://docs.google.com/")) {
      return new Response(null, { status: 302, headers: { location: "https://doc-0o-00-sheets.googleusercontent.com/export.csv" } })
    }
    return new Response("email,name\nb@example.com,B")
  }) as typeof fetch
  const closed = await fetchSheetRows(input)
  assert.equal(closed.access, "private")
  assert.equal(closed.rows.length, 1)
  const tokenCall = seen.find((c) => c.url === "https://oauth2.googleapis.com/token")!
  assert.ok(tokenCall, "the token is fetched from Google's token endpoint")
  const assertion = new URLSearchParams(tokenCall.body).get("assertion")!
  const [h, c, sig] = assertion.split(".")
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url")), "the JWT is signed with the key")
  const claims = JSON.parse(Buffer.from(c, "base64url").toString())
  assert.equal(claims.iss, "bot@project.iam.gserviceaccount.com")
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token")
  for (const call of seen.filter((x) => x.auth)) {
    const host = new URL(call.url).hostname
    assert.ok(host === "docs.google.com" || host.endsWith("-sheets.googleusercontent.com"), `the token went to ${host}`)
    assert.equal(call.auth, "Bearer tok-123")
  }

  // A redirect off Google's hosts is refused with the token as without it.
  globalThis.fetch = (async (url, init) => {
    const auth = new Headers(init?.headers).get("authorization")
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "tok-123", expires_in: 3600 })
    if (!auth) return new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html" } })
    return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })
  }) as typeof fetch
  await assert.rejects(fetchSheetRows(input), /unsupported address/)

  // Without a service account, the failure says how to share it publicly.
  delete process.env.GOOGLE_SA_EMAIL
  delete process.env.GOOGLE_SA_PRIVATE_KEY
  globalThis.fetch = (async () => new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch
  await assert.rejects(fetchSheetRows(input), /Anyone with the link/)
} finally {
  globalThis.fetch = originalFetch
}

console.log("sheet fetch security checks passed (host allowlist, redirects, HTML and size bounds, service-account token scope)")
}

main().catch((error) => { console.error(error); process.exit(1) })
