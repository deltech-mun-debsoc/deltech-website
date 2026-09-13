#!/usr/bin/env tsx
// Outbound links must use the configured origin for their AWS environment and
// must never leak localhost from a stale build variable.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { resolveAppUrl } from "../src/lib/app-url"

assert.equal(resolveAppUrl("https://deltechmun.in"), "https://www.deltechmun.in")
assert.equal(resolveAppUrl("https://test.deltechmun.in/"), "https://test.deltechmun.in")
assert.equal(resolveAppUrl(undefined), "")
assert.equal(resolveAppUrl("   "), "")

// Local development may intentionally emit a loopback URL.
assert.equal(resolveAppUrl("http://localhost:3000", false), "http://localhost:3000")
assert.equal(resolveAppUrl("http://127.0.0.1:3000", false), "http://127.0.0.1:3000")

// A hosted image fails closed instead of printing a useless phone/QR link.
assert.equal(resolveAppUrl("http://localhost:3000", true), "")
assert.equal(resolveAppUrl("http://127.0.0.1:3000", true), "")
assert.equal(resolveAppUrl(undefined, true), "")

const CONSUMERS = [
  "src/lib/resend.ts",
  "src/lib/payments/razorpay.ts",
  "src/lib/payments/upi.ts",
  "src/lib/payments/public-link.ts",
  "src/app/(public)/status/[token]/page.tsx",
  "src/app/(admin)/admin/quiz/[id]/present/_components/presenter-app.tsx",
]
for (const file of CONSUMERS) {
  const src = readFileSync(file, "utf8")
  assert.doesNotMatch(
    src,
    /process\.env\.NEXT_PUBLIC_APP_URL/,
    `${file} must import from @/lib/app-url instead of reading the env directly`,
  )
  assert.match(src, /from "@\/lib\/app-url"/, `${file} must import the shared origin`)
}

const source = readFileSync("src/lib/app-url.ts", "utf8")
assert.match(source, /const hosted = !!process\.env\.APP_ENV/)

console.log(`✅ check-app-url passed (${CONSUMERS.length} consumers, AWS origin pinned)`)
