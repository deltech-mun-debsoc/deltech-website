// The recruitment authorization matrix. Pure string/set logic: no Prisma, no
// React, no next/headers, so it is importable from the edge, from server
// actions, from client components (for cosmetic affordances only) and from
// scripts/check-recruitment-permissions.ts.
//
// This file is the ONLY place that decides who may do what inside recruitment.
// UI checks are never authoritative: every server action resolves a role through
// src/lib/recruitment/authz.ts and asks `can()` before it writes.

export type RecruitmentRoleName = "JC" | "MAINTAINER" | "ADMIN"

export type CycleStateName =
  | "DRAFT"
  | "OPEN"
  | "IN_PROGRESS"
  | "PAUSED"
  | "FINALISATION"
  | "COMPLETED"
  | "ARCHIVED"
  | "CANCELLED"

// Every mutating or privileged read in the module. Adding an action here without
// adding it to CAPABILITIES is a type error, which is the point.
export type RecruitmentAction =
  // cycle administration
  | "cycle.create"
  | "cycle.configure"
  | "cycle.transition"
  | "cycle.assignStaff"
  // groups
  | "group.create"
  | "group.edit"
  | "group.assignCandidates"
  | "group.assignStaff"
  | "group.archive"
  // sessions
  | "session.view"
  | "session.start"
  | "session.pause"
  | "session.resume"
  | "session.finish"
  | "session.abort"
  | "session.reopen"
  | "session.markAttendance"
  // evaluations
  | "evaluation.draft"
  | "evaluation.submit"
  | "evaluation.revise"
  | "evaluation.void"
  | "evaluation.viewOthers"
  // candidates
  | "candidate.view"
  | "candidate.edit"
  | "candidate.advance"
  | "candidate.bypassGd"
  | "candidate.reverseBypass"
  | "candidate.hold"
  | "candidate.withdraw"
  | "candidate.disqualify"
  | "candidate.reconsider"
  | "candidate.override"
  | "candidate.finalise"
  | "candidate.recruit"
  // imports
  | "import.configure"
  | "import.preview"
  | "import.apply"
  // audit
  | "audit.view"

const ALL: readonly RecruitmentRoleName[] = ["JC", "MAINTAINER", "ADMIN"]
const MAINTAINER_UP: readonly RecruitmentRoleName[] = ["MAINTAINER", "ADMIN"]
const ADMIN_ONLY: readonly RecruitmentRoleName[] = ["ADMIN"]

// Which roles may perform each action. A JC is deliberately near-powerless: it
// can see what it is assigned to, help run a session, and record an evaluation
// where a maintainer enabled it. It can never bypass GD, configure anything,
// move a candidate between stages, or manage people.
export const CAPABILITIES: Record<RecruitmentAction, readonly RecruitmentRoleName[]> = {
  "cycle.create": ADMIN_ONLY,
  "cycle.configure": ADMIN_ONLY,
  "cycle.transition": ADMIN_ONLY,
  "cycle.assignStaff": ADMIN_ONLY,

  "group.create": MAINTAINER_UP,
  "group.edit": MAINTAINER_UP,
  "group.assignCandidates": MAINTAINER_UP,
  "group.assignStaff": MAINTAINER_UP,
  "group.archive": MAINTAINER_UP,

  // A JC may watch and help run a session it is assigned to (scoping is enforced
  // separately by requireGroupAccess) but may not change its lifecycle.
  "session.view": ALL,
  "session.start": MAINTAINER_UP,
  "session.pause": MAINTAINER_UP,
  "session.resume": MAINTAINER_UP,
  "session.finish": MAINTAINER_UP,
  "session.abort": MAINTAINER_UP,
  // Reopening a session that was wrongly completed rewrites history; admin only.
  "session.reopen": ADMIN_ONLY,
  "session.markAttendance": ALL,

  // A JC can only draft/submit where a maintainer set canEvaluate on their
  // group assignment: checked in authz, on top of this matrix.
  "evaluation.draft": ALL,
  "evaluation.submit": ALL,
  // Revising your own submitted score is allowed for maintainers and admins;
  // a JC's submission is final to stop score-shopping under pressure.
  "evaluation.revise": MAINTAINER_UP,
  "evaluation.void": ADMIN_ONLY,
  // JCs see only their own scores, so panels stay independent.
  "evaluation.viewOthers": MAINTAINER_UP,

  "candidate.view": ALL,
  "candidate.edit": MAINTAINER_UP,
  "candidate.advance": MAINTAINER_UP,
  // Explicitly withheld from JCs, per spec.
  "candidate.bypassGd": MAINTAINER_UP,
  "candidate.reverseBypass": ADMIN_ONLY,
  "candidate.hold": MAINTAINER_UP,
  "candidate.withdraw": MAINTAINER_UP,
  "candidate.disqualify": MAINTAINER_UP,
  "candidate.reconsider": ADMIN_ONLY,
  // Repairing an invalid state is the admin's break-glass.
  "candidate.override": ADMIN_ONLY,
  "candidate.finalise": ADMIN_ONLY,
  "candidate.recruit": ADMIN_ONLY,

  "import.configure": ADMIN_ONLY,
  "import.preview": MAINTAINER_UP,
  "import.apply": MAINTAINER_UP,

  "audit.view": MAINTAINER_UP,
}

export function can(role: RecruitmentRoleName | null | undefined, action: RecruitmentAction): boolean {
  if (!role) return false
  const allowed = CAPABILITIES[action]
  return allowed ? allowed.includes(role) : false
}

// ---------------------------------------------------------------------------
// Cycle state gate
// ---------------------------------------------------------------------------
//
// A permitted role still cannot act when the cycle's state forbids it. Both
// checks must pass; `can()` alone is never sufficient.

// Read-only everywhere. Never gated by cycle state.
const ALWAYS_ALLOWED: readonly RecruitmentAction[] = [
  "session.view",
  "candidate.view",
  "evaluation.viewOthers",
  "audit.view",
]

// Setting up before candidates arrive.
const SETUP: readonly RecruitmentAction[] = [
  "cycle.configure",
  "cycle.transition",
  "cycle.assignStaff",
  "import.configure",
]

// The full operational surface: only while recruitment is actually running.
//
// `candidate.finalise` lives here as well as in FINALISATION. It used to be
// FINALISATION-only, which made Hold a dead end: an admin looking at a candidate
// who had just finished their interview saw a greyed-out Hold and no Selected or
// Reject at all, because `mayPerform` refused the capability in an OPEN cycle.
// Meanwhile session Finish was already writing SELECTED and REJECTED directly in
// that same state, so the panel could select someone the admin was forbidden to.
// The role gate is the real protection here and it is unchanged: ADMIN_ONLY.
const OPERATIONS: readonly RecruitmentAction[] = [
  "group.create",
  "group.edit",
  "group.assignCandidates",
  "group.assignStaff",
  "group.archive",
  "session.start",
  "session.pause",
  "session.resume",
  "session.finish",
  "session.abort",
  "session.reopen",
  "session.markAttendance",
  "evaluation.draft",
  "evaluation.submit",
  "evaluation.revise",
  "evaluation.void",
  "candidate.edit",
  "candidate.advance",
  "candidate.bypassGd",
  "candidate.reverseBypass",
  "candidate.hold",
  "candidate.withdraw",
  "candidate.disqualify",
  "candidate.reconsider",
  "candidate.override",
  "candidate.finalise",
  "import.preview",
  "import.apply",
]

// Deciding outcomes. Sessions are over; scores may still be repaired by an admin.
const FINALISATION: readonly RecruitmentAction[] = [
  "candidate.finalise",
  "candidate.recruit",
  "candidate.hold",
  "candidate.reconsider",
  "candidate.override",
  "evaluation.void",
  "evaluation.revise",
  "candidate.edit",
]

export const CYCLE_STATE_ALLOWS: Record<CycleStateName, readonly RecruitmentAction[]> = {
  // Not yet open: configure and import, but nothing operational.
  DRAFT: [...SETUP, "import.preview", "import.apply", "candidate.edit"],
  // Open for responses; groups can be prepared ahead of the first session.
  OPEN: [...SETUP, ...OPERATIONS],
  IN_PROGRESS: [...SETUP, ...OPERATIONS],
  // Paused: nothing may start or advance, but in-flight evaluations can be saved
  // and submitted so a pause never destroys unsaved panel work.
  PAUSED: [
    "cycle.transition",
    "cycle.configure",
    "cycle.assignStaff",
    "evaluation.draft",
    "evaluation.submit",
    "session.pause",
    "session.abort",
    "candidate.override",
    // Deciding is not operational work on a session, so pausing the cycle to work
    // through the decision backlog is a legitimate thing to want to do.
    "candidate.finalise",
    "candidate.hold",
  ],
  // Sessions are done; results are being decided.
  FINALISATION: ["cycle.transition", "cycle.assignStaff", ...FINALISATION],
  // Closed. Recruiting a candidate who was already selected is still allowed,
  // because finalisation and adding to the society are separate actions and the
  // second may legitimately happen later.
  COMPLETED: ["cycle.transition", "candidate.recruit", "candidate.override"],
  // Historical. Read-only apart from reopening the cycle.
  ARCHIVED: ["cycle.transition"],
  CANCELLED: ["cycle.transition"],
}

export function cycleAllows(state: CycleStateName, action: RecruitmentAction): boolean {
  if (ALWAYS_ALLOWED.includes(action)) return true
  // Creating a cycle is not scoped to an existing cycle's state.
  if (action === "cycle.create") return true
  return CYCLE_STATE_ALLOWS[state]?.includes(action) ?? false
}

// ---------------------------------------------------------------------------
// Cycle state machine
// ---------------------------------------------------------------------------

export const CYCLE_TRANSITIONS: Record<CycleStateName, readonly CycleStateName[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "PAUSED", "FINALISATION", "CANCELLED"],
  IN_PROGRESS: ["PAUSED", "FINALISATION", "CANCELLED"],
  PAUSED: ["IN_PROGRESS", "OPEN", "FINALISATION", "CANCELLED"],
  FINALISATION: ["COMPLETED", "IN_PROGRESS", "CANCELLED"],
  // Reopening a completed cycle is a deliberate admin repair, not a dead end.
  COMPLETED: ["ARCHIVED", "FINALISATION"],
  ARCHIVED: ["COMPLETED"],
  // Terminal.
  CANCELLED: [],
}

export function canTransitionCycle(from: CycleStateName, to: CycleStateName): boolean {
  return CYCLE_TRANSITIONS[from]?.includes(to) ?? false
}

// States in which a recruitment participant should see the operational UI at all.
export function isCycleLive(state: CycleStateName): boolean {
  return state === "OPEN" || state === "IN_PROGRESS" || state === "PAUSED" || state === "FINALISATION"
}

// ---------------------------------------------------------------------------
// Role resolution helpers (pure half: the Prisma half lives in authz.ts)
// ---------------------------------------------------------------------------

// A global ADMIN is an implicit recruitment ADMIN on every cycle, so an admin can
// always repair a cycle they were never assigned to. Every other app role: even
// MAINTAINER: gets recruitment authority ONLY from an explicit per-cycle
// assignment, which is what keeps the two permission systems independent.
export function resolveRecruitmentRole(
  appRole: string | null | undefined,
  membershipRole: RecruitmentRoleName | null | undefined,
): { role: RecruitmentRoleName | null; implicit: boolean } {
  if (appRole === "ADMIN") return { role: "ADMIN", implicit: !membershipRole }
  if (membershipRole) return { role: membershipRole, implicit: false }
  return { role: null, implicit: false }
}

// Rank for "at least this role" comparisons. Not a substitute for `can()`,
// capabilities are not strictly hierarchical (a JC may submit an evaluation a
// maintainer configured; only an admin may void one).
const RANK: Record<RecruitmentRoleName, number> = { JC: 1, MAINTAINER: 2, ADMIN: 3 }

export function atLeast(role: RecruitmentRoleName | null | undefined, min: RecruitmentRoleName): boolean {
  return !!role && RANK[role] >= RANK[min]
}
