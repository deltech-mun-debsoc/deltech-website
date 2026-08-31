#!/usr/bin/env tsx
// Query cost regressions are invisible: the page still renders, just slower and
// with a bigger payload. These assert the shapes that were fixed, so an
// innocent-looking `include` cannot quietly put them back.
import assert from "node:assert"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(p, "utf8")

// --- the indexes exist -----------------------------------------------------
{
  const schema = read("prisma/schema.prisma")
  const required: [string, string][] = [
    ["Delegate", "@@index([status])"],
    ["Delegate", "@@index([createdAt])"],
    ["Delegate", "@@index([status, checkedInAt])"],
    ["Allotment", "@@index([committeeId])"],
    ["Payment", "@@index([status])"],
    ["EmailLog", "@@index([delegateId])"],
    ["EmailLog", "@@index([status, sentAt])"],
    ["Portfolio", "@@index([status])"],
    ["Post", "@@index([authorId])"],
    ["Post", "@@index([status, publishedAt])"],
    ["Slide", "@@index([presentationId, order])"],
    ["QuarantinedRow", "@@index([resolvedAt])"],
  ]
  for (const [model, index] of required) {
    const block = schema.slice(schema.indexOf(`model ${model} {`))
    const body = block.slice(0, block.indexOf("\n}"))
    assert.ok(body.includes(index), `${model} is missing ${index}`)
  }

  const migration = read("prisma/migrations/20260729140000_add_query_indexes/migration.sql")
  const statements = (migration.match(/^CREATE INDEX/gm) ?? []).length
  assert.equal(statements, required.length, "every schema index needs a migration statement")
}

// --- /admin/checkin is bounded and does not ship whole committees ---------
//
// "All statuses" sends status="", which fails the validity test, so
// `where.status` was never set and the query returned every delegate. With
// `include: { committee: true }` that dragged each committee's agenda,
// ebMembers JSON and matrixBrief into the client payload, for a mapper that
// reads only committee.name.
{
  const src = read("src/app/(admin)/admin/checkin/page.tsx")
  assert.match(src, /take: ROW_CAP/, "the check-in query must be bounded")
  assert.doesNotMatch(src, /^\s*include: \{ committee: true \}/m, "only committee.name is rendered")
  assert.match(src, /committee: \{ select: \{ name: true \} \}/, "select the one field used")
}

// --- the registrations table does not join every email ever sent ----------
{
  const types = read("src/app/(admin)/admin/registrations/_lib/types.ts")
  const include = types.slice(types.indexOf("export const delegateInclude"), types.indexOf("} as const"))
  assert.doesNotMatch(include, /emailLogs/, "emailLogs must not ride along with the table query")

  const actions = read("src/app/(admin)/admin/registrations/actions.ts")
  assert.match(actions, /export async function getDelegateEmailLogs/, "the drawer needs its own fetch")
  assert.match(actions, /take: 50/, "and it must be bounded")
}

// --- committee refs are deduped per request -------------------------------
//
// createDelegateFromRow calls getCommitteeRefs as its first line and its
// callers loop, so a 300-row import fired 300 identical queries.
{
  const src = read("src/lib/intake.ts")
  assert.match(src, /export const getCommitteeRefs = cache\(/, "getCommitteeRefs must be request-cached")
}

// --- portfolio rows are not fetched purely to be counted ------------------
for (const p of ["src/app/(admin)/admin/page.tsx", "src/app/(marketing)/page.tsx"]) {
  const src = read(p)
  assert.doesNotMatch(
    src,
    /portfolios: \{ select: \{ status: true \} \}/,
    `${p} must count with groupBy, not by pulling one row per seat`,
  )
  assert.match(src, /groupBy\(\{\s*by: \["committeeId", "status"\]/, `${p} must use a grouped count`)
}

// --- quiz answers stay concurrent, and rank is a DB aggregate --------------
{
  const src = read("src/app/api/quiz/responses/route.ts")
  assert.match(src, /FOR SHARE/, "answers need a shared lock so phones remain concurrent while close/end is atomic")
  assert.doesNotMatch(src, /FOR UPDATE/, "answer submission must not serialize every phone behind one exclusive lock")
  assert.match(src, /having: \{ points: \{ _sum: \{ gt: myTotal \} \} \}/, "rank must be counted in the DB")
  assert.doesNotMatch(
    src,
    /allNicknames\.filter/,
    "ranking must not pull every nickname in the session on every submission",
  )
}

// --- the quiz route does not ship an animation library --------------------
//
// This is the one route that has to load on a few hundred phones on venue
// wifi, and both animations were decorative.
{
  const src = read("src/app/(public)/quiz/[code]/_components/participant-app.tsx")
  assert.doesNotMatch(src, /^import .* from "framer-motion"/m, "the quiz route must not import framer-motion")
  assert.match(src, /motion-reduce:animate-none/, "the reduced-motion behaviour must be preserved")
}

// --- recharts is split out of the admin landing page ----------------------
{
  const src = read("src/app/(admin)/admin/page.tsx")
  assert.match(src, /dynamic\(\s*\(\) => import\("\.\/_components\/status-bar-chart"\)/, "charts must be split")
}

console.log("✅ check-perf passed")
