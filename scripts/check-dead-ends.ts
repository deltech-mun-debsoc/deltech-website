#!/usr/bin/env tsx
// Dead ends are absences: a missing file, a branch that renders nothing, a
// terminal screen with no way on. None of them fail a build, and none of them
// are visible in a diff unless you know to look. This pins the ones fixed.
import assert from "node:assert"
import { existsSync, readFileSync } from "node:fs"

const read = (p: string) => readFileSync(p, "utf8")

// --- staff 404s must keep the admin shell ---------------------------------
//
// notFound() in checkin/[token], blog/[id] and quiz/[id] fell through to the
// marketing 404: sidebar gone, and the only button pointing at the public
// homepage. A volunteer scanning a bad QR at the desk had to retype the URL.
{
  assert.ok(existsSync("src/app/(admin)/not-found.tsx"), "the (admin) group needs its own not-found")
  const src = read("src/app/(admin)/not-found.tsx")
  assert.match(src, /href="\/admin"/, "the admin 404 must route back into the admin area")
  assert.doesNotMatch(src, /href="\/"\s/, "the admin 404 must not dump staff on the marketing home")
}

// --- slow routes show something ------------------------------------------
for (const route of [
  "src/app/(admin)/admin/checkin",
  "src/app/(admin)/admin/users",
  "src/app/(admin)/admin/logs",
  "src/app/(admin)/admin/recruitment",
  "src/app/(admin)/admin/team",
  "src/app/(admin)/admin/import",
  // revalidate = 0, joins the whole conference, and is the homepage CTA target.
  "src/app/(marketing)/availability",
]) {
  assert.ok(existsSync(`${route}/loading.tsx`), `${route} does real work and needs a loading.tsx`)
}

// --- a rejected author is told why ----------------------------------------
//
// rejectPost wrote reviewNote and sent nothing, unlike approve and
// requestChanges which both mail the author. /write then rendered the note
// only for CHANGES_REQUESTED, so the reason existed nowhere the author looked.
{
  const actions = read("src/app/(admin)/admin/blog/[id]/actions.ts")
  assert.match(actions, /sendBlogRejected/, "rejectPost must notify the author")
  for (const fn of ["sendBlogApproved", "sendBlogChangesRequested", "sendBlogRejected"]) {
    assert.match(actions, new RegExp(`notifyAuthor\\([\\s\\S]{0,120}?${fn}`), `${fn} must go through notifyAuthor`)
  }
  // Fire-and-forget hid every delivery failure behind a redirect.
  assert.doesNotMatch(actions, /void import\("@\/lib\/resend"\)/, "review emails must be awaited")

  const writePage = read("src/app/(author)/write/page.tsx")
  assert.match(
    writePage,
    /post\.status === "CHANGES_REQUESTED" \|\| post\.status === "REJECTED"/,
    "the review note must render for REJECTED too",
  )
  assert.ok(existsSync("src/emails/blog-rejected.tsx"), "the rejection email template must exist")
}

// --- a valid pay token never renders the marketing 404 --------------------
{
  const src = read("src/app/(public)/pay/[token]/page.tsx")
  assert.match(src, /if \(!delegate\) notFound\(\)/, "only an unknown token is a 404")
  assert.doesNotMatch(
    src,
    /if \(!delegate\?\.payment\) notFound\(\)/,
    "a known delegate without a payment row needs an explanation, not a 404",
  )
  assert.match(src, /Nothing to pay yet/, "the no-payment state must say what is going on")
  assert.match(src, /\/status\/\$\{delegate\.publicToken\}/, "and must offer a way onward")
}

// --- the import wizard's terminal screen leads somewhere ------------------
{
  const src = read("src/app/(admin)/admin/import/_components/import-wizard.tsx")
  assert.match(src, /href="\/admin\/registrations"/, "the done screen must link to the result")
  assert.match(src, /result\.quarantined > 0/, "quarantined rows must be surfaced, not just counted")
  assert.match(read("src/app/(admin)/admin/import/page.tsx"), /id="quarantine"/, "the anchor must exist")
}

// --- the audit trail is reachable past the first page ---------------------
{
  const src = read("src/app/(admin)/admin/logs/page.tsx")
  assert.match(src, /skip: \(pageNum - 1\) \* PAGE_SIZE/, "logs must paginate")
  assert.doesNotMatch(src, /Latest 100 shown/, "the copy must not still claim a hard cap")
  const client = read("src/app/(admin)/admin/logs/_components/logs-client.tsx")
  assert.match(client, /Activity detail/, "clicking a log needs a real detail sheet")
  assert.match(client, /Confirm rollback/, "rollback needs an explicit confirmation step")
  assert.match(
    read("src/app/(admin)/admin/logs/actions.ts"),
    /STALE_STATE/,
    "rollback must refuse to overwrite a newer change",
  )
}

// --- payment links cannot point delegates at localhost --------------------
{
  const link = read("src/lib/payments/public-link.ts")
  assert.match(link, /localhost/, "persisted loopback payment links need a repair path")
  for (const page of [
    "src/app/(public)/status/[token]/page.tsx",
    "src/app/(registerer)/dashboard/page.tsx",
  ]) {
    assert.match(read(page), /publicPaymentLink/, `${page} must repair legacy payment links`)
  }
}

// --- deleting a team card never crashes the whole admin page --------------
{
  const actions = read("src/app/(admin)/admin/team/actions.ts")
  const manager = read("src/app/(admin)/admin/team/_components/team-manager.tsx")
  const route = read("src/app/api/admin/team/[id]/route.ts")
  assert.match(actions, /try \{[\s\S]*?requireAdmin\(\)/, "authorization failures must be contained")
  assert.match(actions, /member\.deleteMany/, "team deletion must be safe to retry from a stale tab")
  assert.match(actions, /revalidatePath\("\/admin\/team"\)/, "the admin roster must refresh")
  assert.match(actions, /revalidatePath\("\/team"\)/, "the public roster must refresh")
  assert.match(manager, /fetch\(`\/api\/admin\/team\//, "deletion must not crash the RSC tree")
  assert.match(route, /deleteMember\(id\)/, "the JSON route must reuse the guarded deletion")
}

// --- a quiz nickname collision is caught, not silently absorbed -----------
//
// Two people typing "Arnav" merged into one leaderboard row, and the second
// one's answer returned 409 while the UI said "Answer received".
{
  const src = read("src/app/(public)/quiz/[code]/_components/participant-app.tsx")
  assert.match(src, /presenceState\(\)/, "presence already knows the room; use it at join time")
  assert.match(src, /res\.status === 409/, "a 409 must not be shown as a successful submission")
  assert.match(src, /quiz\.nicknameTaken/, "the collision needs its own message")
}

console.log("✅ check-dead-ends passed")
