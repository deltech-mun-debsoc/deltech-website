#!/usr/bin/env tsx
// Runnable check for the GD -> PI handover:
//   npx tsx scripts/check-recruitment-pipeline.ts
//
// The defect this pins: finishing a GD session moved candidates to GD_COMPLETE and
// stopped. GD_COMPLETE appears in no queue (the GD list wants INTAKE/GD_PENDING,
// the PI list is a list of GROUPS), and the one action that could move them on,
// moveCandidateStage, had no UI caller. Candidates vanished between rounds.
//
// Also pins that a GD panel cannot record SELECT: selecting someone is a hiring
// decision made after PI, not on a discussion round.
import assert from "node:assert"
import { newerOf } from "../src/lib/recruitment/evaluation-merge"
import { existsSync, readFileSync } from "node:fs"
import {
  nextNaturalStage,
  type CandidateSnapshot,
  type CandidateStageName,
} from "../src/lib/recruitment/transitions"
import {
  createGroupSchema,
  evaluationInputSchema,
  RECOMMENDATIONS_BY_KIND,
  recommendationAllowed,
  resolvePanelRecommendation,
} from "../src/lib/schemas/recruitment"

function at(stage: CandidateStageName, over: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return { stage, result: "PENDING", gdRequired: true, piRequired: true, ...over }
}

assert.equal(
  createGroupSchema.safeParse({ kind: "PI", title: "A", candidateIds: ["candidate-1"] }).success,
  true,
  "a one-letter candidate name must not block one-click PI",
)
assert.equal(
  createGroupSchema.safeParse({ kind: "PI", title: "A", candidateIds: [] }).success,
  false,
  "an interview cannot exist without its one candidate",
)
assert.equal(
  createGroupSchema.safeParse({ kind: "PI", title: "A", candidateIds: ["candidate-1", "candidate-2"] }).success,
  false,
  "an interview cannot contain multiple candidates",
)
assert.equal(
  evaluationInputSchema.safeParse({
    candidateId: "candidate-1",
    sessionId: "session-1",
    scores: {},
    panelistUserId: "jc-user-1",
  }).success,
  true,
  "a panel lead must be able to select an assigned evaluator on the shared device",
)
assert.equal(
  createGroupSchema.safeParse({ kind: "PI", title: "   ", candidateIds: ["candidate-1"] }).success,
  false,
  "an actually blank interview title must still be rejected",
)

// --- the pipeline reaches PI without a hardcoded GD -> PI edge ---------------
{
  assert.equal(nextNaturalStage(at("GD_COMPLETE")), "PI_PENDING", "a finished GD leads to the PI queue")
  assert.equal(nextNaturalStage(at("GD_BYPASSED")), "PI_PENDING", "a bypassed GD also leads to PI")

  // The flags decide, not the stage order.
  assert.equal(
    nextNaturalStage(at("GD_COMPLETE", { piRequired: false })),
    "DECISION",
    "a candidate with no PI required goes straight to the decision queue",
  )
  assert.equal(
    nextNaturalStage(at("INTAKE", { gdRequired: false })),
    "PI_PENDING",
    "a PI-only cycle skips GD entirely",
  )
  assert.equal(nextNaturalStage(at("CLOSED")), null, "a closed candidate has nowhere left to go")
}

// --- session finish advances present candidates ------------------------------
//
// Static assertions against the finish branch: the behaviour lives inside a Prisma
// transaction, so it is asserted here by shape and exercised for real by
// check-recruitment-concurrency.ts against a live database.
{
  const src = readFileSync("src/app/(recruitment)/recruitment/session-actions.ts", "utf8")

  assert.match(src, /finishRecommendations/, "finish must resolve submitted panel recommendations")
  assert.match(
    src,
    /tx\.recruitmentHandoff\.create/,
    "an automatic advance must leave the same handoff trail a manual one does",
  )
  assert.match(
    src,
    /recommendation !== "REJECT" && candidate\.piRequired/,
    "Selected and Hold must move a GD candidate into PI",
  )
  assert.match(
    src,
    /recommendation === "SELECT"[\s\S]*?"SELECTED"[\s\S]*?recommendation === "HOLD"[\s\S]*?"ON_HOLD"/,
    "PI recommendations must become final candidate results",
  )
  // A session must not finish with an unassessed candidate -- and the refusal has
  // to name who, rather than sending the panel hunting through a group of seven.
  assert.match(
    src,
    /Choose Selected, Hold or Reject for \$\{missing\.join/,
    "a session must not finish with an unassessed candidate, and must name them",
  )
  assert.match(src, /missing\.push\(member\.candidate\.fullName\)/, "by name")
  assert.match(
    src,
    /reason: `\$\{recommendation\} panel recommendation applied/,
    "the applied panel recommendation must be auditable",
  )
}

// --- the advance control is actually wired -----------------------------------
//
// The original bug was not bad logic, it was an action nobody called. Assert the
// wiring so it cannot rot back to dead code.
{
  const page = readFileSync("src/app/(recruitment)/recruitment/candidates/page.tsx", "utf8")
  const list = readFileSync(
    "src/app/(recruitment)/recruitment/_components/candidates-list.tsx",
    "utf8",
  )
  assert.match(list, /AdvanceCandidateButton/, "the candidate list must offer an advance control")
  assert.match(
    page,
    /mayPerform\(ctx, "candidate\.advance"\)/,
    "and the server must decide the capability, not the client",
  )

  const button = readFileSync(
    "src/app/(recruitment)/recruitment/_components/advance-candidate-button.tsx",
    "utf8",
  )
  assert.match(button, /moveCandidateStage/, "the button must call the audited action")
}

// --- both rounds use one three-way recommendation ----------------------------
{
  for (const kind of ["GD", "PI"] as const) {
    assert.deepEqual(RECOMMENDATIONS_BY_KIND[kind], ["SELECT", "HOLD", "REJECT"])
    for (const r of ["SELECT", "HOLD", "REJECT"] as const) {
      assert.equal(recommendationAllowed(kind, r), true, `${kind} must allow ${r}`)
    }
    for (const r of ["ADVANCE", "RECONSIDER"] as const) {
      assert.equal(recommendationAllowed(kind, r), false, `${kind} must reject legacy ${r}`)
    }
  }
  assert.equal(resolvePanelRecommendation([]), null)
  assert.equal(resolvePanelRecommendation(["SELECT"]), "SELECT")
  assert.equal(resolvePanelRecommendation(["SELECT", "SELECT", "REJECT"]), "SELECT")
  assert.equal(resolvePanelRecommendation(["SELECT", "REJECT"]), "HOLD")

  // The form must read the kind prop it receives rather than a fixed list, and the
  // server must refuse a forged value rather than trusting the UI.
  const form = readFileSync(
    "src/app/(recruitment)/recruitment/_components/evaluation-form.tsx",
    "utf8",
  )
  assert.match(form, /RECOMMENDATIONS_BY_KIND\[kind\]/, "the form must scope options by session kind")
  assert.match(form, /!recommendation/, "submission must require a recommendation")

  const actions = readFileSync("src/app/(recruitment)/recruitment/evaluation-actions.ts", "utf8")
  assert.match(
    actions,
    /recommendationAllowed\(target\.kind, data\.recommendation\)/,
    "the server must enforce the kind/recommendation pairing itself",
  )
  assert.match(
    actions,
    /Choose Selected, Hold, or Reject before submitting/,
    "the server must require a recommendation before submission",
  )
}

// --- popups stay inside their area's theme scope -----------------------------
//
// The dark variant is scope-aware and the theme class sits on a shell div, so a
// popup portalled to document.body renders in the wrong theme.
{
  for (const file of ["select.tsx", "dialog.tsx", "dropdown-menu.tsx"]) {
    const src = readFileSync(`src/components/ui/${file}`, "utf8")
    assert.match(
      src,
      /useThemedPortalContainer/,
      `${file} must portal into the themed shell, not document.body`,
    )
  }

  // Two separate defects made the dropdowns look empty. A trigger with no
  // SelectValue draws no label at all; and without `items` on the root, Base UI
  // cannot resolve a value to its label and falls back to the raw enum, so the
  // trigger reads "ADVANCE" instead of "Advance".
  for (const file of [
    "src/app/(recruitment)/recruitment/_components/evaluation-form.tsx",
    "src/app/(admin)/admin/recruitment/_components/cycle-staff-panel.tsx",
  ]) {
    const src = readFileSync(file, "utf8")
    assert.doesNotMatch(src, /<SelectTrigger[^>]*\/>/, `${file} has a self-closing SelectTrigger`)
    assert.match(src, /<SelectValue/, `${file} must render the selected value`)
  }

  const finalisation = readFileSync(
    "src/app/(admin)/admin/recruitment/_components/finalisation-panel.tsx",
    "utf8",
  )
  assert.match(finalisation, /societyRole: "MEMBER"/, "finalisation must always create a member")
  assert.doesNotMatch(finalisation, /<Select/, "a one-option membership choice must not render a dropdown")

  const evaluation = readFileSync(
    "src/app/(recruitment)/recruitment/_components/evaluation-form.tsx",
    "utf8",
  )
  assert.match(evaluation, /items=\{recommendationItems\}/, "the trigger must resolve labels via items")

  // Attendance is internal history, not an operator task in either round.
  const console_ = readFileSync(
    "src/app/(recruitment)/recruitment/_components/session-console.tsx",
    "utf8",
  )
  assert.doesNotMatch(console_, /setAttendance/, "the console must not expose attendance controls")
  assert.doesNotMatch(console_, /AttendanceBadge/, "the console must not display attendance state")

  const schema = readFileSync("prisma/schema.prisma", "utf8")
  assert.match(schema, /attendance\s+Attendance\s+@default\(EXPECTED\)/, "new seats start unconfirmed")

  const sessionActions = readFileSync(
    "src/app/(recruitment)/recruitment/session-actions.ts",
    "utf8",
  )
  assert.match(
    sessionActions,
    /attendance: \{ not: "REASSIGNED" \}[\s\S]*?attendance: "PRESENT"/,
    "starting any rostered session must confirm its candidates automatically",
  )
  assert.match(
    sessionActions,
    /const present = members\.map/,
    "finishing must consider the full non-reassigned roster",
  )
  assert.match(
    sessionActions,
    /SELECT id FROM "User"[\s\S]*?kind: "PI"[\s\S]*?state: \{ in: \["ACTIVE", "PAUSED"\] \}[\s\S]*?controllerId: ctx\.userId/,
    "one account must not control two interviews at the same time, even across racing tabs",
  )

  const piQueue = readFileSync(
    "src/app/(recruitment)/recruitment/_components/pi-queue.tsx",
    "utf8",
  )
  assert.match(piQueue, /staff: starterMemberId/, "one-click PI must assign its initiating panel member")

  const groupDialog = readFileSync(
    "src/app/(recruitment)/recruitment/_components/create-group-dialog.tsx",
    "utf8",
  )
  assert.match(groupDialog, /return \[\.\.\.selected, \.\.\.matches\]/, "picked GD candidates stay on top")

  const configSchema = readFileSync("src/lib/schemas/recruitment.ts", "utf8")
  assert.match(
    configSchema,
    /societyRoles:[\s\S]*?z\.literal\("MEMBER"\)/,
    "recruitment finalisation must create members only",
  )
  assert.doesNotMatch(
    configSchema.match(/societyRoles:[\s\S]*?export type RecruitmentCycleConfig/)?.[0] ?? "",
    /AUTHOR|SUB_MAINTAINER|REGISTERER/,
    "author and internal application roles must not leak into society finalisation",
  )

  const candidatesList = readFileSync(
    "src/app/(recruitment)/recruitment/_components/candidates-list.tsx",
    "utf8",
  )
  assert.match(candidatesList, /view === "final"/, "candidate list must expose final selections")
  assert.match(
    candidatesList,
    /c\.result !== "SELECTED" && c\.result !== "ON_HOLD"/,
    "final selections must include Selected and Hold",
  )
  assert.match(candidatesList, /<Link[\s\S]*?prefetch/, "dossier links must preload their route")
  assert.match(
    candidatesList,
    /<PostInterviewDecision/,
    "a completed interview must expose the actual outcome instead of a dead-end stage",
  )

  const postInterviewDecision = readFileSync(
    "src/app/(recruitment)/recruitment/_components/post-interview-decision.tsx",
    "utf8",
  )
  for (const outcome of ["SELECTED", "ON_HOLD", "REJECTED"]) {
    assert.match(
      postInterviewDecision,
      new RegExp(`"${outcome}"`),
      `the post-interview decision must offer ${outcome}`,
    )
  }
  // Button and badge read from one table, so they can never name an outcome
  // differently on two screens.
  assert.match(
    postInterviewDecision,
    /recruitment\.result\.\$\{result\}/,
    "and must name outcomes from the shared string table",
  )
  assert.match(
    postInterviewDecision,
    /setCandidateResult/,
    "post-interview decisions must write the result used by Final selections",
  )
  assert.match(finalisation, /finalFilter/, "final selections must be filterable")
  assert.match(
    finalisation,
    /PostInterviewDecision/,
    "final selections decisions must remain editable",
  )

  const evaluationActions = readFileSync(
    "src/app/(recruitment)/recruitment/evaluation-actions.ts",
    "utf8",
  )
  // Everyone scores as themselves. The "Whose evaluation is this?" picker and the
  // delegated write behind it are gone: one operator drives the site while the rest
  // of the panel deliberate off it, so the picker was a one-entry dropdown of raw
  // email addresses guarding a path nobody took. Who sat on the panel is still
  // recorded on the group's staff roster, which is asserted below.
  assert.doesNotMatch(
    evaluationActions,
    /panelistUserId/,
    "an evaluation must be attributed to its author, not recorded on someone's behalf",
  )
  assert.match(
    evaluationActions,
    /const evaluatorId = ctx\.userId/,
    "the evaluator is the caller",
  )
  const evaluationForm = readFileSync(
    "src/app/(recruitment)/recruitment/_components/evaluation-form.tsx",
    "utf8",
  )
  assert.doesNotMatch(evaluationForm, /panelistDevice|switchEvaluator/, "the picker must stay gone")

  // The panel roster is the audit record of who ran the session, so it must
  // survive the picker's removal and stay on screen.
  const dossierPage = readFileSync(
    "src/app/(recruitment)/recruitment/candidates/[id]/page.tsx",
    "utf8",
  )
  assert.match(dossierPage, /s\.staff\.map/, "the dossier must still name the panel that sat")
  const groupList = readFileSync(
    "src/app/(recruitment)/recruitment/_components/group-list.tsx",
    "utf8",
  )
  assert.match(groupList, /g\.staff\.map/, "and so must the group list")

  const consoleQueries = readFileSync(
    "src/app/(recruitment)/recruitment/_lib/queries.ts",
    "utf8",
  )
  assert.match(consoleQueries, /previousGdAttempts/, "judges must see earlier completed GD attempts")
}

// --- a decision has to be reachable ---------------------------------------
//
// The Selected/Hold/Reject buttons were gated on `hasCompletedPi` alone, which
// needs a PI group membership joined to a COMPLETED PI session. On real data that
// was false for exactly the people awaiting a call -- the candidates resting at
// PI_COMPLETE and DECISION -- so the Hold button was never clickable anywhere. It
// was reported as "Hold is not working"; it was never rendered.
{
  const list = readFileSync(
    "src/app/(recruitment)/recruitment/_components/candidates-list.tsx",
    "utf8",
  )
  assert.match(list, /function decidable\(/, "a decidable() predicate must gate the decision buttons")
  for (const stage of ["PI_COMPLETE", "DECISION", "CLOSED"]) {
    assert.match(
      list,
      new RegExp(`DECIDED_STAGES[\\s\\S]{0,120}${stage}`),
      `a candidate at ${stage} must be able to receive a decision`,
    )
  }
  assert.doesNotMatch(
    list,
    /\{c\.hasCompletedPi && \(canHold \|\| canFinalise\)/,
    "the PI-session-only gate must stay gone",
  )

  // "Send to GD" only flipped a stage badge that createGroup sets anyway.
  assert.doesNotMatch(list, /advanceToGd/, "the redundant Send to GD button must stay gone")
  // Advancing to PI is NOT redundant: it is the deliberate "no time for a GD"
  // call, and nothing else makes it.
  assert.match(list, /advanceToPi/, "advancing to PI must remain available")
}

// --- a hold is a question still open, not an answer ------------------------
{
  const sessionActions = readFileSync(
    "src/app/(recruitment)/recruitment/session-actions.ts",
    "utf8",
  )
  assert.match(
    sessionActions,
    /candidate\.result !== "PENDING" && candidate\.result !== "ON_HOLD"/,
    "re-interviewing a held candidate must apply the new panel verdict, not discard it",
  )
}

// --- the panel list is searchable, in the browser --------------------------
{
  const dialog = readFileSync(
    "src/app/(recruitment)/recruitment/_components/create-group-dialog.tsx",
    "utf8",
  )
  assert.match(dialog, /const \[staffQuery, setStaffQuery\]/, "the panel needs its own filter")
  assert.match(dialog, /visibleStaff/, "and a filtered list to render")
  // Both lists filter in memory. A server round trip per keystroke is what this
  // whole surface was moved off.
  assert.doesNotMatch(dialog, /fetch\(|router\.push/, "filtering must not touch the server")
}

// --- every recruitment route answers immediately ----------------------------
//
// A route that resolves a session, a cycle and a membership before it renders
// anything leaves the previous screen on the glass with no sign it heard the
// click. That reads as a slow site rather than a loading one.
{
  for (const route of [
    "recruitment",
    "recruitment/candidates",
    "recruitment/candidates/[id]",
    "recruitment/responses",
    "recruitment/gd",
    "recruitment/gd/[groupId]",
    "recruitment/pi",
    "recruitment/pi/[groupId]",
    "recruitment/audit",
  ]) {
    assert.ok(
      existsSync(`src/app/(recruitment)/${route}/loading.tsx`),
      `${route} needs a loading skeleton`,
    )
  }
  const authz = readFileSync("src/lib/recruitment/authz.ts", "utf8")
  assert.match(
    authz,
    /import \{ cache \} from "react"/,
    "session and cycle resolution must be memoised per request",
  )
  assert.match(authz, /const sessionUser = cache\(/, "the layout and the page must share one session lookup")
}

// --- scoring a panel is not a per-candidate chore ---------------------------
//
// Submit used to be pressed once per candidate before Finish would accept the
// session: eight taps for a group of seven, and a refusal naming whoever was
// missed. The score now autosaves as a draft and finishing promotes every
// complete draft in the same transaction that applies the verdict.
{
  const form = readFileSync(
    "src/app/(recruitment)/recruitment/_components/evaluation-form.tsx",
    "utf8",
  )
  assert.match(form, /const autosave = useCallback/, "a first score must save itself")
  // The submit button survives only for revising work already agreed.
  assert.match(
    form,
    /\{submitted && \(\s*<Button/,
    "a submit button must appear only for a revision",
  )
  assert.match(form, /recruitment\.evaluation\.saving/, "and the panel must see it saving")

  const sessionActions = readFileSync(
    "src/app/(recruitment)/recruitment/session-actions.ts",
    "utf8",
  )
  assert.match(
    sessionActions,
    /state: "SUBMITTED", submittedAt: serverNow/,
    "finishing must promote complete drafts",
  )
  // Only complete ones: finish must not submit a half-scored candidate.
  assert.match(
    sessionActions,
    /validateScores\([\s\S]{0,120}requireAll: true/,
    "an incomplete draft must be left alone",
  )
  // And nothing may be written before the whole roster is known to be settled:
  // returning from a Prisma transaction COMMITS it, so promoting drafts before
  // the completeness check left half a panel submitted by a refused finish.
  assert.ok(
    sessionActions.indexOf("Choose Selected, Hold or Reject for") <
      sessionActions.indexOf('data: { state: "SUBMITTED", submittedAt: serverNow }'),
    "the refusal must come before any promotion is written",
  )
  assert.match(
    sessionActions,
    /evaluatorId: ctx\.userId,\s*state: "DRAFT"/,
    "finishing promotes only the caller's own drafts",
  )
}

// --- a reason for skipping GD, not an essay --------------------------------
{
  const schema = readFileSync("src/lib/schemas/recruitment.ts", "utf8")
  assert.doesNotMatch(schema, /min\(10, "Explain why GD/, "the arbitrary character floor must stay gone")
  assert.match(schema, /reason: z\.string\(\)\.trim\(\)\.min\(1/, "but a reason is still required")
  const button = readFileSync(
    "src/app/(recruitment)/recruitment/_components/bypass-gd-button.tsx",
    "utf8",
  )
  // A disabled control that says nothing reads as a broken one.
  assert.match(button, /bypassReasonRequired/, "an empty reason must say what it needs")
}

// --- a hold parks a candidate, it does not close them -----------------------
//
// setCandidateResult moved EVERY non-PENDING outcome to CLOSED, ON_HOLD included.
// The PI queue only re-offers candidates at GD_COMPLETE, GD_BYPASSED or PI_PENDING,
// so pressing Hold silently removed them from the process instead of parking them
// in it -- the manual twin of the finish-session dead end fixed in #86.
{
  const candidateActions = readFileSync(
    "src/app/(recruitment)/recruitment/candidate-actions.ts",
    "utf8",
  )
  assert.match(
    candidateActions,
    /const closes = data\.to === "SELECTED" \|\| data\.to === "REJECTED"/,
    "only a final outcome closes a candidate",
  )
  assert.doesNotMatch(
    candidateActions,
    /data\.to === "PENDING" \? \{\} : \{ stage: "CLOSED" \}/,
    "a hold must not close the candidate",
  )
  const queue = readFileSync("src/app/(recruitment)/recruitment/pi/page.tsx", "utf8")
  assert.match(
    queue,
    /result: \{ in: \["PENDING", "ON_HOLD"\] \}/,
    "and the interview queue must still re-offer held candidates",
  )
}

// --- a finished panel stays reachable ---------------------------------------
//
// Finish sets the group to DONE. GD listed everything but ARCHIVED, so finished
// panels buried the live ones; PI listed only DRAFT/READY/RUNNING and filtered the
// candidate out of the queue by their new membership, so a finished interview had
// no link anywhere in the app and a mis-scored one could not be corrected.
{
  const queries = readFileSync("src/app/(recruitment)/recruitment/_lib/queries.ts", "utf8")
  assert.match(queries, /export const LIVE_GROUP_STATES/, "live panel states must be named")
  assert.match(queries, /export const PAST_GROUP_STATES = \["DONE"\]/, "so must finished ones")

  const gd = readFileSync("src/app/(recruitment)/recruitment/gd/page.tsx", "utf8")
  assert.match(gd, /PAST_GROUP_STATES/, "the GD page must fetch finished panels")

  const pi = readFileSync("src/app/(recruitment)/recruitment/pi/page.tsx", "utf8")
  assert.match(pi, /state: "DONE"/, "the interview page must fetch finished interviews")

  // Both lists ship together and the toggle is in-memory state: a tab that fetches
  // is a tab that makes the site feel slow, which is the whole reason for #87.
  // (pi-queue keeps a router.push, but for navigating to a newly started interview.)
  for (const [file, marker] of [
    ["src/app/(recruitment)/recruitment/_components/group-list.tsx", "past"],
    ["src/app/(recruitment)/recruitment/_components/pi-queue.tsx", "visiblePast"],
  ] as const) {
    const source = readFileSync(file, "utf8")
    assert.match(source, new RegExp(marker), `${file} must render the past list`)
    assert.match(source, /TabStrip/, `${file} must switch tabs in the browser`)
    assert.doesNotMatch(source, /fetch\(/, `${file} must not go to the server to switch tabs`)
  }
}

// --- an interview is one person, not a roster of one ------------------------
{
  const consolePage = readFileSync(
    "src/app/(recruitment)/recruitment/_components/group-console-page.tsx",
    "utf8",
  )
  assert.match(consolePage, /InterviewConsole/, "PI must have its own console")
  assert.match(
    consolePage,
    /kind: "GD", state: "SUBMITTED"/,
    "and the interview must load the candidate's GD record, which its own description promises",
  )
  const interview = readFileSync(
    "src/app/(recruitment)/recruitment/_components/interview-console.tsx",
    "utf8",
  )
  assert.match(interview, /gdBypassed \?/, "a skipped GD must say so rather than render an empty panel")
  // The clock and its lifecycle buttons carry the optimistic conflict-adoption
  // logic. Two copies of that would drift, so both consoles import one.
  for (const file of [
    "src/app/(recruitment)/recruitment/_components/session-console.tsx",
    "src/app/(recruitment)/recruitment/_components/interview-console.tsx",
  ]) {
    assert.match(readFileSync(file, "utf8"), /SessionControls/, `${file} must share the session controls`)
    assert.doesNotMatch(readFileSync(file, "utf8"), /takeSessionControl/, `${file} must not re-implement them`)
  }
}

// --- interviews are not a Junior Council surface ----------------------------
{
  const nav = readFileSync("src/app/(recruitment)/_components/recruitment-nav.ts", "utf8")
  assert.match(
    nav,
    /href: "\/recruitment\/pi",[\s\S]*?requires: "group\.create"/,
    "the PI destination must be gated",
  )
  const pi = readFileSync("src/app/(recruitment)/recruitment/pi/page.tsx", "utf8")
  // The nav is cosmetic. The queue names every candidate past GD and is NOT scoped
  // by visibleGroupIds, so the page has to guard itself.
  assert.match(
    pi,
    /if \(!can\(ctx\.role, "group\.create"\)\) redirect\("\/recruitment"\)/,
    "and the page must refuse a JC who types the URL",
  )
  // The console too: being staffed on a PI group must not become a way around a
  // gate the nav and the queue both enforce.
  assert.match(
    readFileSync("src/app/(recruitment)/recruitment/_components/group-console-page.tsx", "utf8"),
    /kind === "PI" && !can\(ctx\.role, "group\.create"\)/,
    "the interview console must refuse a JC as well",
  )
}

// --- the audit trail names people, not cuids --------------------------------
//
// Every row used to be a raw event slug over two JSON blobs. The candidateId and
// groupId columns were written on every relevant event and never read, so "what
// happened to this person" could only be answered from a database client.
{
  const viewer = readFileSync(
    "src/app/(recruitment)/recruitment/_components/audit-viewer.tsx",
    "utf8",
  )
  assert.match(viewer, /const candidateById = new Map/, "the audit trail must resolve candidate ids")
  assert.match(viewer, /const groupById = new Map/, "and group ids")
  // Batched, never per row: this is already the heaviest page in the module.
  assert.match(viewer, /id: \{ in: \[\.\.\.new Set\(events\.map/, "in one query each, not one per row")
  assert.match(viewer, /function describe\(/, "and say what happened in a sentence")
  // Demoted, not deleted. An audit trail drops nothing.
  assert.match(viewer, /<details/, "the raw record must still be reachable")
  assert.match(viewer, /JSON\.stringify\(e\.previousState/, "including the before state")
  assert.match(viewer, /JSON\.stringify\(e\.newState/, "and the after state")
  // filters.candidate was accepted by the page and had no control anywhere.
  assert.match(viewer, /name="candidate"/, "and a candidate filter must exist in the form")
  assert.match(viewer, /fullName: \{ contains: candidateQuery/, "taking a name, not an id")
}

// --- a save shows itself, without waiting for a refresh ---------------------
//
// EvaluationForm re-seeds its fields whenever the row id changes, and a revision
// ALWAYS mints a new id. So an RSC refresh that had not yet seen the write would
// re-seed from the pre-write row and visibly undo what was just typed -- a save
// that appeared to have been ignored. The action returns the row it wrote and the
// client adopts it, the same way SessionControls adopts the session.
{
  const actions = readFileSync(
    "src/app/(recruitment)/recruitment/evaluation-actions.ts",
    "utf8",
  )
  assert.match(actions, /export interface SavedEvaluation\b/, "the action must return the row it wrote")
  assert.match(actions, /saved: savedFrom\(/, "every success path must carry it")
  // Four write paths plus the idempotent recovery: none may return without it.
  assert.equal(
    (actions.match(/ok: true as const,|ok: true,/g) ?? []).length,
    (actions.match(/saved: savedFrom\(/g) ?? []).length,
    "every ok:true return must include the saved row",
  )

  const form = readFileSync(
    "src/app/(recruitment)/recruitment/_components/evaluation-form.tsx",
    "utf8",
  )
  assert.match(form, /const \[adopted, setAdopted\]/, "the form must hold the adopted row")
  assert.match(form, /newerOf\(adopted, serverMine/, "and pick between it and the server row by version")

  // The merge rule itself, exercised rather than grepped. Getting it wrong in one
  // direction undoes the user's save; in the other it silently swallows another
  // evaluator's revision, which is the harder failure to notice.
  const local = { version: 2, tag: "local" }
  const server = { version: 1, tag: "server" }
  assert.equal(newerOf(local, server)!.tag, "local", "a newer local save must not be clobbered")
  assert.equal(newerOf({ version: 1, tag: "local" }, { version: 3, tag: "server" })!.tag, "server",
    "a newer server row must win")
  // A tie is the same write seen twice; the server copy carries every field.
  assert.equal(newerOf({ version: 2, tag: "local" }, { version: 2, tag: "server" })!.tag, "server",
    "ties go to the server")
  assert.equal(newerOf(null, server)!.tag, "server", "no local row yet")
  assert.equal(newerOf(local, null)!.tag, "local", "no server row yet")
  assert.equal(newerOf(null, null), null, "neither")
  assert.match(form, /function unchanged\(\)/, "a revision that changes nothing must not be written")
}

// --- an interview hands you back, a group discussion does not ---------------
{
  const interview = readFileSync(
    "src/app/(recruitment)/recruitment/_components/interview-console.tsx",
    "utf8",
  )
  assert.match(
    interview,
    /onRevised=\{\(\) => router\.push\("\/recruitment\/pi"\)\}/,
    "a revised interview must return to the queue",
  )
  const group = readFileSync(
    "src/app/(recruitment)/recruitment/_components/session-console.tsx",
    "utf8",
  )
  // A panel of several candidates may be revised in any order; navigating away
  // after each one would be worse than the extra click.
  assert.doesNotMatch(group, /onRevised/, "a group discussion console must stay put")
}

// --- mutations must invalidate the pages they change ------------------------
//
// revalidatePath("/recruitment") invalidates only that page. Every nested route
// -- both consoles and the dossier -- was never invalidated by any mutation.
{
  for (const file of [
    "src/app/(recruitment)/recruitment/evaluation-actions.ts",
    "src/app/(recruitment)/recruitment/candidate-actions.ts",
    "src/app/(recruitment)/recruitment/session-actions.ts",
    "src/app/(recruitment)/recruitment/group-actions.ts",
    "src/app/(admin)/admin/recruitment/actions.ts",
  ]) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /revalidatePath\("\/(admin\/)?recruitment"\)/,
      `${file} must invalidate the nested recruitment routes, not just the index`,
    )
  }
}

console.log("recruitment pipeline checks passed (three-way decisions, final selections, popups)")
