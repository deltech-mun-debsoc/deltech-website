#!/usr/bin/env tsx
// Runnable check: npx tsx scripts/check-staging-isolation.ts
//
// Staging exists so interns can break things without touching production. Every
// property below is one that, if quietly removed, would not fail a build or a
// test -- it would just silently reconnect staging to something real. That is
// the failure mode this file exists to catch.
//
// Deliberately static: it reads repo files and asserts on their text. No network,
// no database, no environment. It runs in PR CI via the check-*.ts glob, so it
// must never be able to flake.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(__dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

// ── 1. The destructive seed keeps all four of its guards ────────────────────
//
// It truncates ~20 tables. Each guard blocks a different way of pointing it at
// the wrong database.
{
  const seed = read("prisma/seed-staging.ts")

  assert.match(
    seed,
    /ALLOW_DESTRUCTIVE_SEED\s*!==\s*"1"/,
    "seed-staging must refuse without ALLOW_DESTRUCTIVE_SEED=1",
  )
  assert.match(
    seed,
    /const PROD_DB_REF = "[a-z0-9]+"/,
    "seed-staging must keep the production project ref it refuses to run against",
  )
  assert.match(
    seed,
    /url\.includes\(PROD_DB_REF\)/,
    "seed-staging must still check DATABASE_URL against the production ref",
  )

  // The allowlist is the one that fails CLOSED. The prod-ref check alone is a
  // blocklist: it happily wipes a colleague's dev database, a restored backup,
  // or next year's cycle, because none of those are "production".
  assert.match(
    seed,
    /STAGING_DB_REF/,
    "seed-staging must require STAGING_DB_REF, so it only runs against a database explicitly named as staging",
  )
  assert.match(
    seed,
    /!url\.includes\(STAGING_DB_REF\)/,
    "seed-staging must verify DATABASE_URL actually contains STAGING_DB_REF",
  )
}

// ── 2. No real people's addresses in the seeded accounts ────────────────────
//
// These were personal Gmail addresses with no passwordHash, so every intern
// sign-in sent a magic link to a real human and waited on them to forward it.
{
  const seed = read("prisma/seed-staging.ts")

  // The owner signs in as himself; nobody else's personal address belongs here.
  const OWNER = /const OWNER_EMAIL = "([^"]+)"/.exec(seed)?.[1]
  assert.ok(OWNER, "expected OWNER_EMAIL to still be declared")

  const personal = [...seed.matchAll(/"([^"]*@(?:gmail|googlemail|google|yahoo|outlook|hotmail)\.com)"/g)]
    .map((m) => m[1])
    .filter((email) => email !== OWNER)

  assert.deepEqual(
    personal,
    [],
    "seeded fixtures must not contain personal email addresses -- staging sends real email, " +
      `so these would reach real people. Use addr("<role>") instead. Found: ${personal.join(", ")}`,
  )

  // And the accounts must be usable without email at all.
  assert.match(
    seed,
    /passwordHash/,
    "seeded accounts must get a passwordHash, so signing in to staging sends no email",
  )
  assert.match(
    seed,
    /STAGING_TEST_PASSWORD/,
    "the shared staging password must come from the environment, never a committed default",
  )
}

// ── 3. Staging must not be wired to a production Google Sheet ───────────────
//
// sheetSyncUrl and sheetPullSources live in the DATABASE, not the environment,
// so they survive into any staging copy. sheetSyncUrl is the dangerous one: it
// WRITES. If the seed stops overriding them, staging silently mirrors test data
// into the real public sheet.
{
  const seed = read("prisma/seed-staging.ts")
  assert.match(
    seed,
    /key:\s*"sheetSyncUrl"/,
    "seed-staging must explicitly set sheetSyncUrl, or staging inherits production's WRITE target",
  )
  assert.match(
    seed,
    /key:\s*"sheetPullSources"/,
    "seed-staging must explicitly set sheetPullSources, or staging imports from production's sheet",
  )
}

// ── 4. Only main and staging may deploy ─────────────────────────────────────
//
// Vercel's ignoreCommand skips the build on exit 0 and builds on exit 1. Every
// other branch must stay skipped: a feature branch that deployed would get the
// Preview env vars, and therefore the staging database.
{
  const vercel = JSON.parse(read("vercel.json")) as { ignoreCommand?: string }
  const cmd = vercel.ignoreCommand
  assert.ok(cmd, "vercel.json must keep an ignoreCommand")

  const refs = (cmd.match(/!=\s*\\?"([^"\\]+)\\?"/g) ?? []).map((m) =>
    m.replace(/.*!=\s*\\?"/, "").replace(/\\?"$/, ""),
  )
  assert.deepEqual(
    refs.sort(),
    ["main", "staging"],
    `exactly main and staging may build. Found: ${refs.join(", ") || "(none)"}`,
  )
}

// ── 5. Every page says it is not production ─────────────────────────────────
//
// This lived in three area headers, which silently exempted the route groups
// with no header: (public), (author), (registerer). That left /signin, /signup,
// /status/[token] and /pay/[token] -- the pages where somebody could register an
// account or look at a payment screen -- with nothing marking them as fake.
// Rendering it once at the root is what stops that gap reopening as route
// groups are added.
{
  const rootLayout = read("src/app/layout.tsx")
  assert.match(
    rootLayout,
    /<PreviewRibbon\s*\/>/,
    "the root layout must render <PreviewRibbon />, so every route group is covered",
  )

  const ribbon = read("src/components/preview-ribbon.tsx")
  // The DIRECTIVE, not the phrase: the file explains the client-bundle caveat in
  // a comment, and a naive substring match hits its own explanation.
  const firstCode = ribbon
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("//"))
  assert.ok(firstCode, "preview-ribbon.tsx appears to be empty")
  assert.doesNotMatch(
    firstCode!,
    /^["']use client["']/,
    "preview-ribbon must stay server-only; VERCEL_ENV is not inlined into client bundles, " +
      "so a client component reading it silently gets false -- on staging, the one place it must work",
  )
  assert.match(ribbon, /IS_PREVIEW/, "the ribbon must gate on IS_PREVIEW, not render unconditionally")
}

console.log("staging isolation checks passed (seed guards, no personal addresses, sheet overrides, deploy refs, preview ribbon)")
