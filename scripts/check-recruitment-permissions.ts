// Runnable check for the recruitment authorization matrix:
//   npx tsx scripts/check-recruitment-permissions.ts
//
// Pins the properties the spec is explicit about, so a future edit to
// CAPABILITIES cannot quietly widen a role. The matrix is enforced server-side by
// src/lib/recruitment/authz.ts; this file guards the matrix itself.
import assert from "node:assert"
import {
  CAPABILITIES,
  CYCLE_STATE_ALLOWS,
  canTransitionCycle,
  can,
  cycleAllows,
  isCycleLive,
  resolveRecruitmentRole,
  atLeast,
  type CycleStateName,
  type RecruitmentAction,
  type RecruitmentRoleName,
} from "../src/lib/recruitment/permissions"

// ── The Junior Council boundary ──────────────────────────────────────────────
// A JC runs group discussions end to end: forms the panel, drives the session,
// scores it, pulls the responses sheet, reads the audit trail. Exactly two things
// are withheld, and this list is the authority on which.
const JC_MUST_NOT: RecruitmentAction[] = [
  // 1. Interviews. Never the queue, never a PI console, never the scores behind it.
  "interview.conduct",
  // 2. Ending a candidacy. A JC moves people along the pipeline; it never decides
  //    where one stops.
  "candidate.finalise",
  "candidate.recruit",
  "candidate.withdraw",
  "candidate.disqualify",
  // Bypassing GD routes someone straight into an interview, so it belongs to (1).
  "candidate.bypassGd",
  "candidate.reverseBypass",
  // Admin break-glass: repairing invalid state and re-opening settled decisions.
  "candidate.reconsider",
  "candidate.override",
  "session.reopen",
  "evaluation.void",
  // Cycle administration, and re-pointing the sheet the imports read from.
  "cycle.create",
  "cycle.configure",
  "cycle.transition",
  "cycle.assignStaff",
  "import.configure",
]
for (const action of JC_MUST_NOT) {
  assert.equal(can("JC", action), false, `JC must NOT be able to ${action}`)
}

const JC_MAY: RecruitmentAction[] = [
  // Their own panels, without waiting on a maintainer.
  "group.create",
  "group.edit",
  "group.assignCandidates",
  "group.assignStaff",
  "group.archive",
  // ...and driving them.
  "session.view",
  "session.start",
  "session.pause",
  "session.resume",
  "session.finish",
  "session.abort",
  "session.markAttendance",
  "evaluation.draft",
  "evaluation.submit",
  "evaluation.revise",
  "evaluation.viewOthers",
  "candidate.view",
  "candidate.edit",
  "candidate.advance",
  "candidate.hold",
  // Refetching the sheet already configured, and reading the trail.
  "import.preview",
  "import.apply",
  "audit.view",
]
for (const action of JC_MAY) {
  assert.equal(can("JC", action), true, `JC must be able to ${action}`)
}

// Every action is on exactly one of the two lists, so widening a capability
// without deciding which side of the boundary it falls on fails here.
{
  const listed = new Set<string>([...JC_MUST_NOT, ...JC_MAY])
  for (const action of Object.keys(CAPABILITIES)) {
    assert.ok(
      listed.has(action),
      `${action} is on neither JC list — decide whether a JC may do it`,
    )
  }
  assert.equal(listed.size, JC_MUST_NOT.length + JC_MAY.length, "an action is on both JC lists")
}

// ── The trap this refactor exists to close ──────────────────────────────────
// `group.create` used to gate the interview surface, standing in for "is a
// maintainer". The moment a JC could create groups, that stand-in opened the PI
// nav item, the PI queue and the PI console in one edit. These two assertions are
// the pair that must never both be true of the same capability again.
assert.equal(can("JC", "group.create"), true, "a JC forms their own GD panels")
assert.equal(can("JC", "interview.conduct"), false, "...and still never conducts an interview")

// Same shape, second instance: `evaluation.viewOthers` was the tier test guarding
// the per-group canEvaluate grant in group-console-page.tsx. A JC holds it now, so
// that expression MUST test the role instead, or the grant silently dies.
assert.equal(can("JC", "evaluation.viewOthers"), true)
assert.equal(atLeast("JC", "MAINTAINER"), false)

// ── Maintainer runs operations but cannot administer the cycle ───────────────
const MAINTAINER_MAY: RecruitmentAction[] = [
  "group.create",
  "group.assignCandidates",
  "group.assignStaff",
  "session.start",
  "session.pause",
  "session.resume",
  "session.finish",
  "session.abort",
  "candidate.advance",
  "candidate.bypassGd",
  "evaluation.submit",
  "evaluation.revise",
  "evaluation.viewOthers",
  "import.preview",
  "import.apply",
  "audit.view",
]
for (const action of MAINTAINER_MAY) {
  assert.equal(can("MAINTAINER", action), true, `MAINTAINER must be able to ${action}`)
}

const MAINTAINER_MUST_NOT: RecruitmentAction[] = [
  "cycle.create",
  "cycle.configure",
  "cycle.transition",
  "cycle.assignStaff",
  "candidate.finalise",
  "candidate.recruit",
  "candidate.override",
  "candidate.reconsider",
  "candidate.reverseBypass",
  "session.reopen",
  "evaluation.void",
  "import.configure",
]
for (const action of MAINTAINER_MUST_NOT) {
  assert.equal(can("MAINTAINER", action), false, `MAINTAINER must NOT be able to ${action}`)
}

// ── Admin has full recruitment control ──────────────────────────────────────
for (const action of Object.keys(CAPABILITIES) as RecruitmentAction[]) {
  assert.equal(can("ADMIN", action), true, `ADMIN must be able to ${action}`)
}

// No role at all can do anything.
for (const action of Object.keys(CAPABILITIES) as RecruitmentAction[]) {
  assert.equal(can(null, action), false, `null role must NOT be able to ${action}`)
  assert.equal(can(undefined, action), false, `undefined role must NOT be able to ${action}`)
}

// Every action is present in the matrix (no silent default-allow / default-deny).
assert.ok(Object.keys(CAPABILITIES).length > 30, "expected the full action surface in CAPABILITIES")
for (const [action, roles] of Object.entries(CAPABILITIES)) {
  assert.ok(Array.isArray(roles) && roles.length > 0, `${action} has no roles — likely a typo`)
  for (const r of roles) {
    assert.ok(["JC", "MAINTAINER", "ADMIN"].includes(r), `${action} lists unknown role ${r}`)
  }
}

// ── Recruitment and dashboard permissions are evaluated independently ────────
// A global ADMIN is an implicit recruitment admin, flagged as implicit.
assert.deepEqual(resolveRecruitmentRole("ADMIN", null), { role: "ADMIN", implicit: true })
// An explicit assignment on top of global ADMIN is still ADMIN, no longer implicit.
assert.deepEqual(resolveRecruitmentRole("ADMIN", "JC"), { role: "ADMIN", implicit: false })
// A dashboard MAINTAINER gets NOTHING without an explicit recruitment assignment.
assert.deepEqual(resolveRecruitmentRole("MAINTAINER", null), { role: null, implicit: false })
// ...and can hold a *lower* recruitment role than their app role suggests.
assert.deepEqual(resolveRecruitmentRole("MAINTAINER", "JC"), { role: "JC", implicit: false })
// An AUTHOR has no recruitment access unless explicitly assigned (spec: AUTHOR).
assert.deepEqual(resolveRecruitmentRole("AUTHOR", null), { role: null, implicit: false })
// ...but may be assigned any recruitment role, including MAINTAINER.
assert.deepEqual(resolveRecruitmentRole("AUTHOR", "MAINTAINER"), { role: "MAINTAINER", implicit: false })
// A SUB_MAINTAINER app account still needs the per-cycle row — the app role alone
// grants nothing, which is what keeps the two systems separate.
assert.deepEqual(resolveRecruitmentRole("SUB_MAINTAINER", null), { role: null, implicit: false })
assert.deepEqual(resolveRecruitmentRole("SUB_MAINTAINER", "JC"), { role: "JC", implicit: false })
// A REGISTERER (delegate) explicitly assigned as a JC works too — recruitment
// authority never consults the app role except for the ADMIN shortcut.
assert.deepEqual(resolveRecruitmentRole("REGISTERER", "JC"), { role: "JC", implicit: false })
assert.deepEqual(resolveRecruitmentRole(null, null), { role: null, implicit: false })

// ── atLeast ranking ─────────────────────────────────────────────────────────
assert.equal(atLeast("ADMIN", "MAINTAINER"), true)
assert.equal(atLeast("MAINTAINER", "MAINTAINER"), true)
assert.equal(atLeast("JC", "MAINTAINER"), false)
assert.equal(atLeast(null, "JC"), false)

// ── Cycle state gate: a permitted role still cannot act at the wrong time ────
// Nothing operational before the cycle opens.
assert.equal(cycleAllows("DRAFT", "session.start"), false)
assert.equal(cycleAllows("DRAFT", "group.create"), false)
assert.equal(cycleAllows("DRAFT", "cycle.configure"), true)
assert.equal(cycleAllows("DRAFT", "import.apply"), true)

// Running.
assert.equal(cycleAllows("IN_PROGRESS", "session.start"), true)
assert.equal(cycleAllows("IN_PROGRESS", "candidate.bypassGd"), true)
// Deciding a candidate IS an in-progress action.
//
// It used to be FINALISATION-only, which made the Hold button a dead end: an admin
// looking at someone who had just finished their interview got a greyed-out Hold and
// no Selected or Reject at all, while session Finish was already writing SELECTED and
// REJECTED in this very state. The role gate is the protection here, and it is
// asserted immediately below -- widening WHEN a decision may be recorded must never
// be mistaken for widening WHO may record one.
assert.equal(cycleAllows("OPEN", "candidate.finalise"), true)
assert.equal(cycleAllows("IN_PROGRESS", "candidate.finalise"), true)
assert.equal(can("MAINTAINER", "candidate.finalise"), false)
assert.equal(can("JC", "candidate.finalise"), false)
assert.equal(can("ADMIN", "candidate.finalise"), true)

// Paused: nothing starts or advances, but panel work in flight can still be saved
// so a pause never destroys unsubmitted evaluations.
assert.equal(cycleAllows("PAUSED", "session.start"), false)
assert.equal(cycleAllows("PAUSED", "candidate.advance"), false)
assert.equal(cycleAllows("PAUSED", "evaluation.draft"), true)
assert.equal(cycleAllows("PAUSED", "evaluation.submit"), true)
// Deciding is not operational work on a session, so the decision backlog can be
// worked through without un-pausing the cycle.
assert.equal(cycleAllows("PAUSED", "candidate.finalise"), true)
assert.equal(cycleAllows("PAUSED", "candidate.hold"), true)

// Finalisation: decide outcomes, don't run sessions.
assert.equal(cycleAllows("FINALISATION", "candidate.finalise"), true)
assert.equal(cycleAllows("FINALISATION", "session.start"), false)
assert.equal(cycleAllows("FINALISATION", "group.create"), false)

// Completed: finalisation and adding to the society are separate actions, and the
// second may legitimately happen after the cycle closes.
assert.equal(cycleAllows("COMPLETED", "candidate.recruit"), true)
assert.equal(cycleAllows("COMPLETED", "candidate.finalise"), false)
assert.equal(cycleAllows("COMPLETED", "session.start"), false)
assert.equal(cycleAllows("COMPLETED", "evaluation.submit"), false)

// Archived / cancelled are read-only apart from reopening.
for (const state of ["ARCHIVED", "CANCELLED"] as CycleStateName[]) {
  assert.equal(cycleAllows(state, "session.start"), false, `${state} must not allow session.start`)
  assert.equal(cycleAllows(state, "evaluation.submit"), false, `${state} must not allow evaluation.submit`)
  assert.equal(cycleAllows(state, "candidate.recruit"), false, `${state} must not allow candidate.recruit`)
  assert.equal(cycleAllows(state, "cycle.transition"), true, `${state} must allow cycle.transition`)
}

// Reads are never gated by cycle state — an archived cycle stays inspectable.
for (const state of Object.keys(CYCLE_STATE_ALLOWS) as CycleStateName[]) {
  assert.equal(cycleAllows(state, "candidate.view"), true, `${state} must allow candidate.view`)
  assert.equal(cycleAllows(state, "session.view"), true, `${state} must allow session.view`)
  assert.equal(cycleAllows(state, "audit.view"), true, `${state} must allow audit.view`)
  // Creating a NEW cycle is never blocked by another cycle's state.
  assert.equal(cycleAllows(state, "cycle.create"), true, `${state} must allow cycle.create`)
}

// ── Cycle state machine ─────────────────────────────────────────────────────
assert.equal(canTransitionCycle("DRAFT", "OPEN"), true)
assert.equal(canTransitionCycle("DRAFT", "COMPLETED"), false) // no skipping to done
assert.equal(canTransitionCycle("OPEN", "IN_PROGRESS"), true)
assert.equal(canTransitionCycle("IN_PROGRESS", "PAUSED"), true)
assert.equal(canTransitionCycle("PAUSED", "IN_PROGRESS"), true)
assert.equal(canTransitionCycle("FINALISATION", "COMPLETED"), true)
assert.equal(canTransitionCycle("COMPLETED", "ARCHIVED"), true)
// Repair paths exist rather than dead ends.
assert.equal(canTransitionCycle("COMPLETED", "FINALISATION"), true)
assert.equal(canTransitionCycle("ARCHIVED", "COMPLETED"), true)
// CANCELLED is terminal.
assert.equal(canTransitionCycle("CANCELLED", "OPEN"), false)
assert.equal(canTransitionCycle("CANCELLED", "DRAFT"), false)
// A cancelled cycle can be reached from anywhere still running, but not from a
// finished one (that would rewrite history).
assert.equal(canTransitionCycle("IN_PROGRESS", "CANCELLED"), true)
assert.equal(canTransitionCycle("COMPLETED", "CANCELLED"), false)
// Self-transition is not a legal move (callers treat it as a no-op earlier).
assert.equal(canTransitionCycle("OPEN", "OPEN"), false)

// ── isCycleLive drives whether the recruitment UI shows at all ───────────────
assert.equal(isCycleLive("OPEN"), true)
assert.equal(isCycleLive("IN_PROGRESS"), true)
assert.equal(isCycleLive("PAUSED"), true)
assert.equal(isCycleLive("FINALISATION"), true)
assert.equal(isCycleLive("DRAFT"), false)
assert.equal(isCycleLive("COMPLETED"), false)
assert.equal(isCycleLive("ARCHIVED"), false)
assert.equal(isCycleLive("CANCELLED"), false)

// ── Composite: role AND state must both pass ────────────────────────────────
// A maintainer during a paused cycle cannot start a session even though the role
// permits it — this composition is what every server action performs.
const permitted = (role: RecruitmentRoleName, state: CycleStateName, a: RecruitmentAction) =>
  can(role, a) && cycleAllows(state, a)
assert.equal(permitted("MAINTAINER", "IN_PROGRESS", "session.start"), true)
assert.equal(permitted("MAINTAINER", "PAUSED", "session.start"), false)
// A JC drives their own session while the cycle runs...
assert.equal(permitted("JC", "IN_PROGRESS", "session.start"), true)
assert.equal(permitted("JC", "PAUSED", "session.start"), false)
// ...and conducts an interview in no state whatsoever, which is the role boundary
// expressed the way every server action actually evaluates it.
for (const state of Object.keys(CYCLE_STATE_ALLOWS) as CycleStateName[]) {
  assert.equal(
    permitted("JC", state, "interview.conduct"),
    false,
    `a JC must not conduct an interview in ${state}`,
  )
}
assert.equal(permitted("ADMIN", "COMPLETED", "session.start"), false) // even admins
assert.equal(permitted("ADMIN", "COMPLETED", "candidate.recruit"), true)

const actionCount = Object.keys(CAPABILITIES).length
console.log(
  `recruitment permission checks passed (${actionCount} actions, ${Object.keys(CYCLE_STATE_ALLOWS).length} cycle states)`,
)
