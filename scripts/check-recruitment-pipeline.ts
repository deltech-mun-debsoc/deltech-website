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
import { RECOMMENDATIONS_BY_KIND, recommendationAllowed } from "../src/lib/schemas/recruitment"

function at(stage: CandidateStageName, over: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return { stage, result: "PENDING", gdRequired: true, piRequired: true, ...over }
}

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

  assert.match(src, /nextNaturalStage\(/, "finish must derive the next stage, never hardcode PI_PENDING")
  assert.match(
    src,
    /tx\.recruitmentHandoff\.create/,
    "an automatic advance must leave the same handoff trail a manual one does",
  )
  assert.match(
    src,
    /m\.attendance === "EXPECTED" \|\| m\.attendance === "ABSENT"/,
    "unconfirmed candidates and absentees must be returned to the queue, not advanced",
  )
  assert.match(
    src,
    /m\.attendance === "PRESENT" \|\| m\.attendance === "LATE"/,
    "only confirmed attendees may advance when a session finishes",
  )
  assert.match(
    src,
    /if \(candidate\.result !== "PENDING"\) continue/,
    "a decided candidate must not be resurrected into the next queue by a session finish",
  )
  assert.match(
    src,
    /if \(!to \|\| to === "DECISION"\) continue/,
    "auto-advance must stop before DECISION, which is a human call",
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

// --- SELECT is a PI verdict, not a GD one ------------------------------------
{
  assert.ok(!RECOMMENDATIONS_BY_KIND.GD.includes("SELECT" as never), "GD must not offer SELECT")
  assert.ok(RECOMMENDATIONS_BY_KIND.PI.includes("SELECT" as never), "PI keeps SELECT")

  assert.equal(recommendationAllowed("GD", "SELECT"), false)
  assert.equal(recommendationAllowed("PI", "SELECT"), true)
  for (const r of ["ADVANCE", "HOLD", "REJECT", "RECONSIDER"] as const) {
    assert.equal(recommendationAllowed("GD", r), true, `GD must still allow ${r}`)
  }

  // The form must read the kind prop it receives rather than a fixed list, and the
  // server must refuse a forged value rather than trusting the UI.
  const form = readFileSync(
    "src/app/(recruitment)/recruitment/_components/evaluation-form.tsx",
    "utf8",
  )
  assert.match(form, /RECOMMENDATIONS_BY_KIND\[kind\]/, "the form must scope options by session kind")

  const actions = readFileSync("src/app/(recruitment)/recruitment/evaluation-actions.ts", "utf8")
  assert.match(
    actions,
    /recommendationAllowed\(target\.kind, data\.recommendation\)/,
    "the server must enforce the kind/recommendation pairing itself",
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
    "src/app/(admin)/admin/recruitment/_components/finalisation-panel.tsx",
  ]) {
    const src = readFileSync(file, "utf8")
    assert.doesNotMatch(src, /<SelectTrigger[^>]*\/>/, `${file} has a self-closing SelectTrigger`)
    assert.match(src, /<SelectValue/, `${file} must render the selected value`)
  }

  const evaluation = readFileSync(
    "src/app/(recruitment)/recruitment/_components/evaluation-form.tsx",
    "utf8",
  )
  assert.match(evaluation, /items=\{recommendationItems\}/, "the trigger must resolve labels via items")

  // Attendance stays unconfirmed until an operator records an arrival. A
  // forgotten no-show must return to the queue, never advance automatically.
  const console_ = readFileSync(
    "src/app/(recruitment)/recruitment/_components/session-console.tsx",
    "utf8",
  )
  assert.match(console_, /"EXPECTED"/, "attendance must retain an unconfirmed state")
  assert.match(console_, /<SelectValue/, "attendance must expose an explicit picker")

  const schema = readFileSync("prisma/schema.prisma", "utf8")
  assert.match(schema, /attendance\s+Attendance\s+@default\(EXPECTED\)/, "new seats start unconfirmed")

  const sessionActions = readFileSync(
    "src/app/(recruitment)/recruitment/session-actions.ts",
    "utf8",
  )
  assert.match(
    sessionActions,
    /m\.attendance === "EXPECTED" \|\| m\.attendance === "ABSENT"/,
    "unconfirmed candidates must return to the queue",
  )

  const piQueue = readFileSync(
    "src/app/(recruitment)/recruitment/_components/pi-queue.tsx",
    "utf8",
  )
  assert.match(piQueue, /staff: starterMemberId/, "one-click PI must assign its initiating panel member")
}

console.log("recruitment pipeline checks passed (GD->PI advance, absentees, GD recommendations, popups)")
