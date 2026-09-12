#!/usr/bin/env tsx
// The fallback order in resolveAppUrl is what makes staging email testable. If
// someone "simplifies" it back to a bare NEXT_PUBLIC_APP_URL read, nothing
// fails to build: staging just silently starts putting production links in
// every email it sends, which is the exact bug this replaced.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { resolveAppUrl } from "../src/lib/app-url"

// Explicit value wins, and is normalised.
assert.equal(resolveAppUrl("https://deltechmun.in", undefined), "https://www.deltechmun.in")
assert.equal(
  resolveAppUrl("https://test.deltechmun.in/", "ignored.vercel.app"),
  "https://test.deltechmun.in",
  "an explicit origin must win over the Vercel fallback, trailing slash stripped",
)

assert.equal(
  resolveAppUrl("https://deltech-website.vercel.app", undefined, "www.deltechmun.in", true),
  "https://www.deltechmun.in",
  "a hosted production link must not leak the deployment hostname",
)

// A Vercel deployment with no explicit origin falls back to its own URL.
assert.equal(
  resolveAppUrl(undefined, "deltech-website-abc123.vercel.app"),
  "https://deltech-website-abc123.vercel.app",
  "a preview must fall back to its own URL, with a scheme added",
)
assert.equal(
  resolveAppUrl("", "deltech-website-abc123.vercel.app"),
  "https://deltech-website-abc123.vercel.app",
  "an empty string counts as unset; Vercel stores blanks, not nulls",
)
assert.equal(
  resolveAppUrl("   ", "deltech-website-abc123.vercel.app"),
  "https://deltech-website-abc123.vercel.app",
  "whitespace counts as unset",
)

// Vercel supplies the host without a scheme, but tolerate one being pasted in.
assert.equal(
  resolveAppUrl(undefined, "https://already-schemed.vercel.app"),
  "https://already-schemed.vercel.app",
  "must not double up the scheme",
)

// Local dev and dummy CI builds: "" is what every caller already tolerated.
assert.equal(resolveAppUrl(undefined, undefined), "")

// A stale local value in Vercel must never leak into delegate emails or
// payment rows. Prefer Vercel's project Production URL when hosted.
assert.equal(
  resolveAppUrl(
    "http://localhost:3000",
    "deployment-abc.vercel.app",
    "deltechmun.in",
    true,
  ),
  "https://deltechmun.in",
)
assert.equal(
  resolveAppUrl("http://127.0.0.1:3000", "deployment-abc.vercel.app", undefined, true),
  "https://deployment-abc.vercel.app",
)

// No consumer may go back to reading the env directly. app-url.ts is the only
// place either variable is allowed to appear.
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

// A hosted deployment must never emit a loopback link, on ANY environment.
//
// This was production-only, so a Preview build with
// NEXT_PUBLIC_APP_URL=http://localhost:3000 printed localhost into the quiz join
// QR code, the payment links and the magic-link emails. A QR pointing at
// localhost is worse than a broken one: it scans, it opens, and it fails on a
// delegate's phone with no clue why.
{
  for (const env of ["preview", "production"]) {
    assert.equal(
      resolveAppUrl("http://localhost:3000", "deltech-website-abc.vercel.app", "deltechmun.in", true),
      "https://deltechmun.in",
      `a loopback explicit value must be refused on a hosted ${env} deployment`,
    )
  }

  // Falls back to the deployment's own URL when there is no production domain.
  assert.equal(
    resolveAppUrl("http://127.0.0.1:3000", "deltech-website-abc.vercel.app", undefined, true),
    "https://deltech-website-abc.vercel.app",
  )

  // And returns nothing rather than a lie when there is no hosted URL at all.
  assert.equal(resolveAppUrl("http://localhost:3000", undefined, undefined, true), "")

  // Local development is untouched: localhost is the right answer there.
  assert.equal(
    resolveAppUrl("http://localhost:3000", undefined, undefined, false),
    "http://localhost:3000",
  )
}

// Staging must never inherit the production domain as its fallback.
//
// The hardcoded "www.deltechmun.in" used to be passed on ANY Vercel deployment,
// so a staging build that forgot NEXT_PUBLIC_APP_URL emitted production links in
// its emails, payment links and QR codes -- testers would click through from
// staging straight into live data. Staging passes undefined instead and falls
// through to its own deployment URL.
{
  // Staging with its origin set: explicit wins, as on production.
  assert.equal(
    resolveAppUrl("https://test.deltechmun.in", "dep-abc.vercel.app", undefined, true),
    "https://test.deltechmun.in",
    "staging must use its own configured origin",
  )

  // Staging that FORGOT the variable: its own URL, never production.
  const forgotten = resolveAppUrl(undefined, "dep-abc.vercel.app", undefined, true)
  assert.equal(forgotten, "https://dep-abc.vercel.app")
  assert.doesNotMatch(
    forgotten,
    /deltechmun\.in/,
    "a staging deploy missing NEXT_PUBLIC_APP_URL must NOT fall back to the production domain",
  )

  // Production is unchanged: it still gets the canonical domain.
  assert.equal(
    resolveAppUrl(undefined, "dep-abc.vercel.app", "www.deltechmun.in", true),
    "https://www.deltechmun.in",
    "production must still fall back to the canonical domain",
  )

  // The call site is the actual regression surface: the pure function above
  // cannot tell you which argument production passes. Pin that the hardcoded
  // domain is reachable only when the deployment says it is production, and that
  // our own host's APP_ENV wins over Vercel's VERCEL_ENV.
  const src = readFileSync("src/lib/app-url.ts", "utf8")
  assert.match(
    src,
    /deployEnv\s*=\s*process\.env\.APP_ENV\s*\?\?\s*process\.env\.VERCEL_ENV/,
    "app-url.ts must read APP_ENV first, then VERCEL_ENV",
  )
  assert.match(
    src,
    /isProduction\s*=\s*hosted\s*&&\s*deployEnv\s*===\s*"production"/,
    "app-url.ts must gate the production-domain fallback on the deployment being production",
  )
  assert.match(
    src,
    /hosted\s*=\s*process\.env\.VERCEL\s*===\s*"1"\s*\|\|\s*!!process\.env\.APP_ENV/,
    "the AWS host must count as hosted, or it could print localhost into QR codes",
  )
  // Structural, not line-based: canonicalizeProductionDomain mentions the same
  // literal, so pin that the domain is specifically the true-branch of the
  // production test.
  assert.match(
    src,
    /isProduction\s*\n?\s*\?\s*"www\.deltechmun\.in"/,
    "the production domain must be the true-branch of isProduction, so staging cannot reach it",
  )
}

console.log(`✅ check-app-url passed (${CONSUMERS.length} consumers, staging fallback pinned)`)
