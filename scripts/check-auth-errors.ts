#!/usr/bin/env tsx
// A failed sign-in must say something true: npx tsx scripts/check-auth-errors.ts
//
// Three separate failures used to render as one of two useless things, and a
// working sign-in therefore looked broken:
//
//   1. A database fault inside the signIn callback became AccessDenied, and was
//      reported to a real user with a correct address as "Something went wrong".
//   2. Every Auth.js callback failure redirected to /signin?error=<type>, which
//      rendered NOTHING -- verified against production, /signin and
//      /signin?error=Verification had no visible difference.
//   3. An unknown address got fault language instead of guidance.
//
// None of these are visible in a diff, and none fail a build.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { AccessDenied } from "@auth/core/errors"

const read = (p: string) => readFileSync(p, "utf8")

// --- the Auth.js behaviour the whole fix depends on -------------------------
//
// Everything below rests on one upstream detail: AccessDenied carries a cause
// when it wrapped a thrown error, and does not when the callback merely returned
// false. That is an internal of @auth/core, not a documented API, so an upgrade
// could quietly collapse the two -- and every database fault would go back to
// being reported as "Something went wrong" with nothing to notice it by.
{
  const cause = (e: unknown) => (e as { cause?: { err?: unknown } }).cause?.err
  // The constructor is marked @internal and typed as string-only, but Auth.js
  // itself calls it with an Error (`catch (e) { throw new AccessDenied(e) }`).
  // The cast reproduces what the library actually does, which is the whole point
  // of asserting it here rather than trusting it.
  const Ctor = AccessDenied as unknown as new (m: unknown) => Error

  assert.ok(
    cause(new Ctor(new Error("boom"))) instanceof Error,
    "AccessDenied must still expose a thrown callback error at cause.err",
  )
  assert.equal(
    cause(new Ctor("AccessDenied")),
    undefined,
    "a plain refusal must still have no cause, or faults and refusals become indistinguishable again",
  )
}

// --- an infrastructure fault is not a permission denial --------------------
{
  const actions = read("src/app/(public)/signin/actions.ts")

  // The distinction the whole fix rests on. Auth.js throws `new AccessDenied(e)`
  // when the callback throws and `new AccessDenied("AccessDenied")` when it
  // returns false; only the first has a cause. Collapsing both to one message is
  // what hid the database faults.
  assert.match(actions, /function underlyingError/, "actions must be able to tell a thrown callback from a refusal")
  assert.match(actions, /cause\?\.err instanceof Error/, "the two AccessDenied shapes are told apart by cause.err")

  // Both entry points, not just the magic link: authorize() reads the user row
  // too, so a database fault there told someone their correct password was wrong.
  const magic = actions.slice(actions.indexOf("export async function requestMagicLink"), actions.indexOf("export async function signInWithPassword"))
  const password = actions.slice(actions.indexOf("export async function signInWithPassword"))
  for (const [name, body] of [["requestMagicLink", magic], ["signInWithPassword", password]] as const) {
    assert.match(body, /underlyingError\(err\)/, `${name} must check for an underlying error`)
    assert.match(body, /errorRetry/, `${name} must report an infrastructure fault as retriable`)
    assert.match(body, /console\.error/, `${name} must log it -- this path writes no other trace anywhere`)
  }

  // An unknown address lands on the same page a real send does. Naming the
  // reason would confirm which addresses are registered.
  assert.match(magic, /redirect\("\/signin\/sent"\)/, "a refused magic link must land on the check-your-inbox page")
  assert.doesNotMatch(
    magic,
    /if \(err instanceof AuthError\) return \{ error: "errorDefault" \}/,
    "a refusal must not be reported as a fault",
  )
}

// --- ?error= is never silent ------------------------------------------------
{
  const banner = read("src/app/(public)/signin/_components/auth-error-banner.tsx")
  for (const type of ["Verification", "AccessDenied", "Configuration"]) {
    assert.match(banner, new RegExp(`\\b${type}\\b`), `the banner must have a message for ?error=${type}`)
  }
  // An unrecognised type must still say something, or the silence comes back for
  // whichever error type Auth.js adds next.
  assert.match(banner, /\?\?\s*"auth\.errorConfiguration"/, "an unknown error type still needs a message")

  // Both doors: an invited maintainer hits the identical wall at /signin/staff.
  for (const page of [
    "src/app/(public)/signin/page.tsx",
    "src/app/(public)/signin/staff/page.tsx",
  ]) {
    const src = read(page)
    assert.match(src, /error\?: string/, `${page} must accept ?error= in searchParams`)
    assert.match(src, /<AuthErrorBanner error=\{error\}/, `${page} must render the error, not swallow it`)
  }
}

// --- every message the code can ask for exists ------------------------------
{
  const strings = read("src/content/strings.ts")
  for (const key of [
    "errorRetry",
    "errorVerification",
    "errorAccessDenied",
    "errorConfiguration",
    // Said on the sent page, because a typo now lands there looking like success.
    "checkEmailNoAccount",
  ]) {
    assert.match(strings, new RegExp(`\\b${key}:`), `auth.${key} must exist in strings.ts`)
  }
  assert.match(
    read("src/app/(public)/signin/sent/page.tsx"),
    /checkEmailNoAccount/,
    "the sent page must admit nothing arrives for an address with no account",
  )
}

// --- a failed lookup is not a refusal ---------------------------------------
{
  const auth = read("src/lib/auth.ts")
  const fn = auth.slice(auth.indexOf("async function mayStartSession"), auth.indexOf("export const { handlers"))
  assert.match(fn, /catch/, "mayStartSession must retry a dropped pooled connection")
  assert.doesNotMatch(
    fn,
    /catch[\s\S]{0,80}return false/,
    "a failed lookup must never be converted into a refusal -- that is the bug this file exists for",
  )
}

console.log("✅ check-auth-errors passed (faults, refusals and expired links each say their own thing)")
