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

// --- team management never crashes the whole admin page --------------------
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
  assert.match(manager, /method: editing \? "PATCH" : "POST"/, "add and edit must avoid page actions too")
  assert.match(manager, /TEAM_LEVELS\.map/, "the manager must display AC, SC and JC separately")
  for (const council of ["Administrative Council", "Senior Council", "Junior Council"]) {
    assert.match(manager, new RegExp(council), `the manager must spell out ${council}`)
  }
  assert.match(manager, /Photo URL \(optional fallback\)/, "photo storage outages need a usable fallback")

  const publicTeam = read("src/app/(marketing)/team/_components/team-directory.tsx")
  assert.match(publicTeam, /TEAM_LEVELS\.map/, "the public roster must preserve council hierarchy")
  assert.match(publicTeam, /snap-mandatory/, "large councils must use compact horizontal rails")
  assert.match(publicTeam, /Instagram/, "team cards must expose Instagram profiles")
  assert.match(publicTeam, /LinkedIn/, "team cards must expose LinkedIn profiles")

  assert.match(manager, /prepareTeamPhoto/, "team photos must be resized before upload")
  assert.match(
    manager,
    /\/api\/admin\/team\/\$\{encodeURIComponent\(result\.id\)\}\/photo/,
    "photo upload must avoid page actions",
  )
  const photoRoute = read("src/app/api/admin/team/[id]/photo/route.ts")
  assert.match(photoRoute, /MAX_TEAM_PHOTO_BYTES/, "team photos need a server-side size limit")
  assert.match(photoRoute, /photoBytes: bytes/, "prepared photos must persist independently of S3")
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

// --- a menu label without its group is a crash, not a style bug -----------
//
// Base UI's Menu.GroupLabel reads MenuGroupContext and throws when there is
// none. Under Radix the same component renders fine on its own, so writing it
// that way is the natural mistake -- and it does not fail the build, it fails
// on the click: the theme picker in the quiz builder replaced the whole page
// with "Something went wrong" the first time it was opened.
{
  for (const file of ["src/app/(admin)/admin/quiz/[id]/_components/builder-header.tsx"]) {
    const src = read(file)
    if (!src.includes("<DropdownMenuLabel")) continue
    assert.match(src, /<DropdownMenuGroup>/, `${file}: a DropdownMenuLabel needs a DropdownMenuGroup around it`)
    // And the group has to open BEFORE the label, not merely exist somewhere.
    assert.ok(
      src.indexOf("<DropdownMenuGroup>") < src.indexOf("<DropdownMenuLabel"),
      `${file}: the group must enclose the label`,
    )
  }
}

// --- the host can always start ---------------------------------------------
//
// The lobby's start button was disabled until the presence channel reported a
// participant. Presence is 0 before it syncs, 0 when the projector is opened
// first, and 0 permanently wherever realtime is unconfigured -- and there
// getSupabase() returns null by design, so the quiz could never be started at
// all. It failed as a click that did nothing: no error, no console line.
{
  const src = read("src/app/(admin)/admin/quiz/[id]/present/_components/lobby-screen.tsx")
  assert.doesNotMatch(
    src,
    /disabled=\{participants\.length === 0\}/,
    "starting the broadcast must not depend on the presence channel",
  )
  assert.match(src, /quiz\.noOneJoinedYet/, "an empty room is a warning, not a lock")
}

// --- quiz reveal and standings feel like one synchronized product ----------
//
// A participant must not learn the answer before the host reveals it, but the
// reveal also cannot be an unexplained red/green verdict. Standings already
// compute rank deltas server-side; pin the UI that actually makes them visible.
{
  const types = read("src/lib/quiz-types.ts")
  const participant = read("src/app/(public)/quiz/[code]/_components/participant-app.tsx")
  const presenter = read("src/app/(admin)/admin/quiz/[id]/present/_components/presenter-app.tsx")
  const board = read("src/app/(admin)/admin/quiz/[id]/present/_components/leaderboard-screen.tsx")
  const stage = read("src/app/(admin)/admin/quiz/[id]/present/_components/question-screen.tsx")
  const answersViz = read("src/app/(admin)/admin/quiz/[id]/present/_components/viz-mcq.tsx")

  assert.match(types, /event: "REVEAL"; correctIndices: number\[\]; correctAnswers: string\[\]/, "reveal must carry safe answer copy")
  assert.match(presenter, /broadcast\(\{ event: "REVEAL", correctIndices: indices, correctAnswers, resultKey \}\)/, "answers may be sent only in the reveal event")
  assert.match(participant, /payload\.correctAnswers/, "the phone must adopt the host's revealed answer")
  assert.match(participant, /const showVerdict = revealed/, "a phone verdict must remain gated by host reveal")
  assert.match(participant, /stableFeedback/, "feedback copy must not flicker between renders")
  assert.doesNotMatch(participant, /quiz-score-(?:bar|column)/, "the phone leaderboard must stay a ranked list, not a chart")
  assert.match(participant, /movementText\(entry\.delta\)/, "the phone must explain rank movement")
  assert.match(board, /entry\.delta \* 58/, "projector rows must travel from their previous rank")
  assert.doesNotMatch(board, /maxScore|height: `\$\{height\}%`/, "the leaderboard must not turn scores into bars")
  assert.match(board, /<Movement delta=\{entry\.delta\}/, "projector must show position jumps")
  assert.match(board, /t\("quiz\.joinedBoard"\)/, "a new leaderboard entry needs a clear text label")
  assert.doesNotMatch(board, /Sparkles/, "the new-entry marker must not look like an unexplained AI control")
  assert.match(answersViz, /gridTemplateColumns/, "answer choices belong along the chart's x axis")
  assert.match(answersViz, /height: `\$\{height\}%`/, "question results need vertical answer bars")
  assert.match(stage, /font-heading/, "the presenter must use the site's display typography")
  assert.match(stage, /const canAdvance = !scoredQuiz \|\| revealed/, "a scored question cannot skip its reveal")
  assert.match(stage, /mode === "QUIZ" && canAdvance/, "standings must not jump ahead of the answer reveal")
  assert.doesNotMatch(stage, /fontFamily: theme\.font/, "custom quiz fonts must not replace the site typography on the stage")
}

// --- quiz lifecycle is server-owned and reload-safe -------------------------
{
  const schema = read("prisma/schema.prisma")
  const migration = read("prisma/migrations/20260831090000_quiz_session_integrity/migration.sql")
  const actions = read("src/app/(admin)/admin/quiz/[id]/present/actions.ts")
  const presenter = read("src/app/(admin)/admin/quiz/[id]/present/_components/presenter-app.tsx")
  const participant = read("src/app/(public)/quiz/[code]/_components/participant-app.tsx")
  const answers = read("src/app/api/quiz/responses/route.ts")
  const tally = read("src/app/api/quiz/tally/[sessionId]/[slideId]/route.ts")

  for (const field of ["currentSlideDeadlineAt", "currentSlideLockedAt", "currentSlideRevealedAt"]) {
    assert.match(schema, new RegExp(field), `${field} must be persisted on QuizSession`)
  }
  assert.match(migration, /nickname_normalized_key/, "case and whitespace aliases need one database identity")
  assert.match(actions, /pausedMs/, "unlocking must resume the remaining time instead of burning the pause")
  assert.match(actions, /status: "ended"/, "ending must be persisted, not just broadcast")
  assert.match(presenter, /await endSession[\s\S]{0,120}?broadcast\(\{ event: "END" \}\)/, "persist end before notifying phones")
  assert.match(presenter, /api\/quiz\/sessions\?sessionId=/, "a refreshed presenter must recover the live question")
  assert.match(participant, /localStorage\.setItem\(identityStorageKey/, "a refreshed phone must retain its identity")
  assert.match(participant, /recoverOnly: true/, "a refreshed phone must recover its existing answer without creating one")
  assert.match(
    participant,
    /submittedRef\.current = true[\s\S]{0,500}?setAppState\("submitted"\)[\s\S]{0,1000}?keepalive: true/,
    "a phone must acknowledge a tap immediately while its durable write finishes across reloads",
  )
  assert.match(
    participant,
    /ANSWER_ACK_HOLD_MS = 2_000[\s\S]*?setTimeout\([\s\S]{0,500}?setAppState\("result"\)[\s\S]{0,100}?ANSWER_ACK_HOLD_MS\)/,
    "the tap acknowledgement needs a deterministic two-second beat before the reveal wait",
  )
  assert.match(participant, /setInterval\(\(\) => void catchUp\(false\), 5_000\)/, "phones must reconcile missed realtime events")
  assert.match(answers, /FOR SHARE/, "answer, lock and end must not have a last-millisecond race")
  assert.match(answers, /pendingReveal: true/, "the answer API must not leak correctness before reveal")
  assert.match(answers, /currentSlideDeadlineAt[\s\S]{0,500}?time_up/, "the server must enforce the deadline")
  assert.match(tally, /const session = await auth\(\)/, "the live tally must not be a public answer oracle")
  assert.match(presenter, /const persistStart = startSlide[\s\S]{0,900}?broadcast\([\s\S]{0,300}?await persistStart/, "Next must broadcast before waiting for free-tier persistence")
  assert.match(participant, /problem\?\.error !== "slide_not_active"/, "a very fast answer must retry while the slide activation catches up")
}

// --- no dead UI in recruitment ---------------------------------------------
//
// A standing rule, and the general form of nearly every defect reported against
// this module: Skip GD disabled in silence, Hold greyed out with nowhere to go,
// "Send to GD" that only moved a badge, a one-entry panelist dropdown, finished
// sessions with no link. Nothing renders that does nothing.
//
// Both rules below are heuristics over source text, not a renderer. They ratchet
// against the specific shapes that keep recurring; a green run is not a proof
// that no dead UI exists.
{
  const dir = "src/app/(recruitment)/recruitment/_components"

  // 1. A control disabled on anything beyond a transient in-flight flag must say
  //    what unlocks it, in the same file. A tooltip does not count: `title` is
  //    invisible on touch and to keyboard users.
  const gated: [string, string][] = [
    ["create-group-dialog.tsx", "recruitment.groups.titleRequired"],
    ["responses-manager.tsx", "recruitment.responses.sourceIncomplete"],
    ["responses-manager.tsx", "recruitment.responses.previewFirst"],
    ["evaluation-form.tsx", "recruitment.evaluation.needsScores"],
    ["evaluation-form.tsx", "recruitment.evaluation.needsRecommendation"],
    // A JC whose score is final saw an entirely inert form and was told nothing.
    ["evaluation-form.tsx", "recruitment.evaluation.lockedNote"],
  ]
  for (const [file, key] of gated) {
    const src = read(`${dir}/${file}`)
    assert.match(src, new RegExp(key.replace(/\./g, "\\.")), `${file} must explain why its control is disabled`)
  }
  // The hint has to be rendered, not just tucked into a title attribute.
  const responses = read(`${dir}/responses-manager.tsx`)
  assert.match(
    responses,
    /<p className="text-xs text-muted-foreground">\s*\{t\("recruitment\.responses\.previewFirst"\)\}/,
    "the preview-first hint must be visible, not tooltip-only",
  )

  // 2. Nothing may be fetched for the console and rendered nowhere. This is the
  //    general form of the panel roster, previousAttempts and permissions.reopen
  //    -- all three were queried or threaded through and never displayed.
  const queries = read("src/app/(recruitment)/recruitment/_lib/queries.ts")
  const body = queries.slice(queries.indexOf("export async function getGroupConsole"))
  const returned = body.slice(body.indexOf("\n  return {"), body.indexOf("\n}"))
  const keys = [...returned.matchAll(/^    (\w+):/gm)].map((m) => m[1])
  assert.ok(keys.length >= 4, "could not read getGroupConsole's return shape")
  // Deliberately NOT group-console-page.tsx: that file only wires props through,
  // and "passed to a component that never renders it" is precisely how
  // permissions.reopen survived two releases. Only the rendering components count.
  const consumers = ["session-console.tsx", "interview-console.tsx"]
    .map((f) => read(`${dir}/${f}`))
    .join("\n")
  for (const key of keys) {
    assert.match(
      consumers,
      new RegExp(`\\b${key}\\b`),
      `getGroupConsole returns "${key}" and no console renders it -- render it or stop fetching it`,
    )
  }

  // reopenSession was deleted in #86 for having no callers; its permission wire
  // outlived it by two releases.
  const consolePage = read(`${dir}/group-console-page.tsx`)
  assert.doesNotMatch(consolePage, /reopen:/, "the reopen capability has no UI and must not be plumbed")
}

// --- /recruitment must never bounce someone "home" to itself ---------------
//
// roleHome("SUB_MAINTAINER") is "/recruitment". requireRecruitmentAccess used to
// redirect(roleHome(appRole)) on both no-authority paths, so a Junior Council
// account -- invited with a User row and no RecruitmentMember, which is exactly
// the state the invite email drops them in -- redirected /recruitment to itself
// until the browser gave up. Every bounce out of that gate goes through
// bounceHome, which declines to redirect when home is inside this area.
{
  const authz = read("src/lib/recruitment/authz.ts")
  assert.match(authz, /function bounceHome/, "requireRecruitmentAccess needs the bounceHome loop guard")
  assert.doesNotMatch(
    authz,
    /redirect\(roleHome\(/,
    "bounce out of /recruitment via bounceHome, not redirect(roleHome(...)) -- a SUB_MAINTAINER's home is /recruitment itself",
  )
}

console.log("✅ check-dead-ends passed")
