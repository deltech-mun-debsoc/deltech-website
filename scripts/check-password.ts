#!/usr/bin/env tsx
// The password rule used to live inline in signup/actions.ts and be restated
// by a comment in scripts/set-password.ts, with nothing keeping them in step.
// Now every caller goes through validatePassword, and this pins its behaviour.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import {
  validatePassword,
  PASSWORD_MIN,
  PASSWORD_MAX,
  setPasswordSchema,
} from "../src/lib/schemas/password"

const ok = "x".repeat(PASSWORD_MIN)

// --- length ---------------------------------------------------------------

assert.equal(validatePassword(ok), null, "a minimum-length password is accepted")
assert.equal(validatePassword("x".repeat(PASSWORD_MIN - 1)), "passwordTooShort")
assert.equal(validatePassword(""), "passwordTooShort")
assert.equal(validatePassword("x".repeat(PASSWORD_MAX)), null, "the maximum length is inclusive")

// Unbounded input would be a free CPU burn: scrypt hashes whatever it is
// handed, and the sign-in and signup endpoints have no rate limit yet.
assert.equal(validatePassword("x".repeat(PASSWORD_MAX + 1)), "passwordTooLong")

// --- non-strings ----------------------------------------------------------
//
// These arrive from FormData, so a missing field is null and a duplicated
// field is an array. Neither may be treated as a valid password.
assert.equal(validatePassword(null), "passwordTooShort")
assert.equal(validatePassword(undefined), "passwordTooShort")
assert.equal(validatePassword(12345678), "passwordTooShort")
assert.equal(validatePassword(["x".repeat(PASSWORD_MIN)]), "passwordTooShort")

// --- confirmation ---------------------------------------------------------

assert.equal(validatePassword(ok, ok), null)
assert.equal(validatePassword(ok, ok + "y"), "passwordMismatch")
// Length is checked before the match, so a short pair reports the useful error.
assert.equal(validatePassword("short", "short"), "passwordTooShort")
// Omitting the confirm argument skips the check (the /account change form
// supplies it, the CLI script does not).
assert.equal(validatePassword(ok), null)

// --- the zod schema agrees with the helper --------------------------------

assert.equal(setPasswordSchema.safeParse({ password: ok, confirmPassword: ok }).success, true)
assert.equal(
  setPasswordSchema.safeParse({ password: ok, confirmPassword: "nope" }).success,
  false,
)
assert.equal(setPasswordSchema.safeParse({ password: "x", confirmPassword: "x" }).success, false)

// --- the rule is not restated anywhere --------------------------------------
//
// The original bug: two places independently hardcoded "8".
for (const file of ["scripts/set-password.ts"]) {
  const src = readFileSync(file, "utf8")
  assert.match(
    src,
    /from ".*schemas\/password"/,
    `${file} must import the shared password rule instead of restating it`,
  )
  assert.doesNotMatch(
    src,
    /password\.length\s*<\s*\d/,
    `${file} still hardcodes a length check; use validatePassword`,
  )
}

console.log("✅ check-password passed")
