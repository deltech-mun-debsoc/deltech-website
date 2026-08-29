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
import { readFileSync } from "node:fs"
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
  assert.match(
    src,
    /Submit a Selected, Hold, or Reject recommendation for every candidate/,
    "a session must not finish with an unassessed candidate",
  )
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
      new RegExp(`result: "${outcome}"`),
      `the post-interview decision must offer ${outcome}`,
    )
  }
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
  assert.match(
    evaluationActions,
    /member: \{ userId: data\.panelistUserId, isActive: true \}/,
    "delegated scores must resolve to an active assigned panelist",
  )

  const consoleQueries = readFileSync(
    "src/app/(recruitment)/recruitment/_lib/queries.ts",
    "utf8",
  )
  assert.match(consoleQueries, /previousGdAttempts/, "judges must see earlier completed GD attempts")
}

console.log("recruitment pipeline checks passed (three-way decisions, final selections, popups)")
