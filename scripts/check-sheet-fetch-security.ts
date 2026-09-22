#!/usr/bin/env tsx
import assert from "node:assert/strict"
import { fetchSheetText, MAX_SHEET_BYTES, SheetFetchError } from "../src/lib/sheet-fetch"

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
} finally {
  globalThis.fetch = originalFetch
}

console.log("sheet fetch security checks passed (host allowlist, redirects, HTML and size bounds)")
}

main().catch((error) => { console.error(error); process.exit(1) })
