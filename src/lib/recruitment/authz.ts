// Recruitment guards. Mirrors the shape of src/lib/authz.ts (call auth(), redirect
// on failure, return the resolved context so callers can attribute audit rows) so
// the same defense-in-depth convention holds: proxy → layout → per-action guard.
//
// The critical property: recruitment authority comes from RecruitmentMember, NOT
// from User.role. The single exception is a global ADMIN, who is an implicit
// recruitment admin everywhere so a cycle can always be repaired. A dashboard
// MAINTAINER has no recruitment power until someone assigns them, and a
// SUB_MAINTAINER has no dashboard power at all: the two systems are independent.

import { cache } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { roleHome } from "@/lib/nav"
import type { CycleState } from "@/generated/prisma/client"
import { auditRecruitment } from "./audit"
import {
  can,
  cycleAllows,
  isCycleLive,
  resolveRecruitmentRole,
  type CycleStateName,
  type RecruitmentAction,
  type RecruitmentRoleName,
} from "./permissions"

export interface RecruitmentActor {
  userId: string
  email: string
  name: string | null
  appRole: string
  role: RecruitmentRoleName
  // True when authority came from being a global ADMIN rather than an explicit
  // per-cycle assignment. Recorded in audit so implicit power is visible.
  implicit: boolean
}

export interface RecruitmentContext extends RecruitmentActor {
  cycle: {
    id: string
    name: string
    slug: string
    state: CycleStateName
    version: number
    config: unknown
  }
}

// Thrown by the assert* helpers used inside server actions, which return a
// typed error to the client rather than redirecting mid-mutation.
export class RecruitmentDenied extends Error {
  constructor(
    readonly action: RecruitmentAction,
    readonly detail: "not-permitted" | "cycle-state" | "not-assigned",
  ) {
    super(`recruitment: ${action} denied (${detail})`)
    this.name = "RecruitmentDenied"
  }
}

// Per-request memoised, because a recruitment page resolves its context twice:
// once in the layout guard and again in the page itself, and Next gives a layout
// no way to hand what it found to the page below it. On the candidate dossier
// that was four duplicate queries -- session, cycle, membership -- on every open,
// which is most of why it felt slow. `cache` collapses them for the whole render
// without changing a single call site.
const sessionUser = cache(async function sessionUser() {
  const session = await auth()
  const user = session?.user as
    | { id?: string; email?: string | null; name?: string | null; role?: string }
    | undefined
  if (!user?.id || !user.email) return null
  return { id: user.id, email: user.email, name: user.name ?? null, appRole: user.role ?? "AUTHOR" }
})

// Same reasoning: the cycle row and the membership row are read by both the
// layout and the page, and neither changes inside one request.
const cycleById = cache(async function cycleById(cycleId: string) {
  return prisma.recruitmentCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, name: true, slug: true, state: true, version: true, config: true },
  })
})

// ---------------------------------------------------------------------------
// Cycle selection
// ---------------------------------------------------------------------------

// The cycle a recruitment participant is currently working in. Deliberately
// resolved server-side rather than taken from the client, so a JC cannot point
// themselves at a cycle they were never assigned to by editing a URL.
export async function activeCycleForUser(userId: string, appRole: string) {
  const memberships =
    appRole === "ADMIN"
      ? []
      : await prisma.recruitmentMember.findMany({
          where: { userId, isActive: true },
          select: { cycleId: true, role: true },
        })

  // A global admin sees any live cycle; everyone else only their assigned ones.
  const where =
    appRole === "ADMIN"
      ? { state: { in: LIVE_STATES } }
      : { id: { in: memberships.map((m) => m.cycleId) }, state: { in: LIVE_STATES } }

  return prisma.recruitmentCycle.findFirst({
    where,
    orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, slug: true, state: true, version: true, config: true },
  })
}

// Mutable on purpose: Prisma's `in` filter rejects a readonly tuple.
const LIVE_STATES: CycleState[] = ["OPEN", "IN_PROGRESS", "PAUSED", "FINALISATION"]

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

export const recruitmentRoleFor = cache(async function recruitmentRoleFor(
  userId: string,
  appRole: string,
  cycleId: string,
): Promise<{ role: RecruitmentRoleName | null; implicit: boolean }> {
  const membership = await prisma.recruitmentMember.findUnique({
    where: { cycleId_userId: { cycleId, userId } },
    select: { role: true, isActive: true },
  })
  // A revoked membership is no membership. This is what makes "role removed while
  // a page is open" take effect on the next action rather than the next login.
  const membershipRole = membership?.isActive ? membership.role : null
  return resolveRecruitmentRole(appRole, membershipRole)
})

// ---------------------------------------------------------------------------
// Route guards (redirect on failure: for layouts and pages)
// ---------------------------------------------------------------------------

// Gate for the /recruitment layout. Anyone authenticated may reach the route; only
// someone with real recruitment authority on a live cycle gets past this.
// Returning `null` cycle is a legitimate state ("you're staff, nothing is running")
// and renders an empty-state rather than bouncing into a redirect loop.
export async function requireRecruitmentAccess(): Promise<
  | { actor: Omit<RecruitmentActor, "role" | "implicit">; cycle: null; role: null; implicit: false }
  | { actor: Omit<RecruitmentActor, "role" | "implicit">; cycle: RecruitmentContext["cycle"]; role: RecruitmentRoleName; implicit: boolean }
> {
  const user = await sessionUser()
  if (!user) redirect("/signin")

  const cycle = await activeCycleForUser(user.id, user.appRole)
  const actor = { userId: user.id, email: user.email, name: user.name, appRole: user.appRole }

  if (!cycle) {
    // No live cycle. A global admin still belongs here (to see the empty state);
    // anyone else with no assignment anywhere is sent to their own home.
    if (user.appRole === "ADMIN") return { actor, cycle: null, role: null, implicit: false }
    const anyMembership = await prisma.recruitmentMember.count({
      where: { userId: user.id, isActive: true },
    })
    if (anyMembership === 0) redirect(roleHome(user.appRole))
    return { actor, cycle: null, role: null, implicit: false }
  }

  const { role, implicit } = await recruitmentRoleFor(user.id, user.appRole, cycle.id)
  if (!role) {
    await auditRecruitment({
      eventType: "access.denied",
      actor: { id: user.id, email: user.email, role: user.appRole },
      cycleId: cycle.id,
      reason: "No active recruitment membership for the live cycle.",
      outcome: "REJECTED",
    })
    redirect(roleHome(user.appRole))
  }

  return { actor, cycle: cycle as RecruitmentContext["cycle"], role, implicit }
}

// Full context for a specific cycle, asserting one capability. Used by pages that
// are meaningless without permission (e.g. the audit viewer).
export async function requireCycleRole(
  cycleId: string,
  action: RecruitmentAction,
): Promise<RecruitmentContext> {
  const ctx = await resolveCycleContext(cycleId)
  if (!ctx) redirect("/signin")
  try {
    assertCan(ctx, action)
  } catch {
    await auditRecruitment({
      eventType: "access.denied",
      actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
      cycleId,
      reason: `Route requires ${action}.`,
      meta: { action, cycleState: ctx.cycle.state },
      outcome: "REJECTED",
    })
    redirect("/recruitment")
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Action guards (throw on failure: for server actions)
// ---------------------------------------------------------------------------

// Resolve the caller's context for a cycle without asserting anything. Returns
// null when unauthenticated or unassigned.
export async function resolveCycleContext(cycleId: string): Promise<RecruitmentContext | null> {
  const user = await sessionUser()
  if (!user) return null

  const cycle = await cycleById(cycleId)
  if (!cycle) return null

  const { role, implicit } = await recruitmentRoleFor(user.id, user.appRole, cycleId)
  if (!role) return null

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    appRole: user.appRole,
    role,
    implicit,
    cycle: cycle as RecruitmentContext["cycle"],
  }
}

// Both gates, always together: the role must permit the action AND the cycle's
// state must allow it. Callers that catch RecruitmentDenied are responsible for
// writing the REJECTED audit row (see recordDenied).
export function assertCan(ctx: RecruitmentContext, action: RecruitmentAction): void {
  if (!can(ctx.role, action)) throw new RecruitmentDenied(action, "not-permitted")
  if (!cycleAllows(ctx.cycle.state, action)) throw new RecruitmentDenied(action, "cycle-state")
}

export function mayPerform(ctx: RecruitmentContext, action: RecruitmentAction): boolean {
  return can(ctx.role, action) && cycleAllows(ctx.cycle.state, action)
}

// The guard every recruitment server action starts with.
export async function requireRecruitmentAction(
  cycleId: string,
  action: RecruitmentAction,
): Promise<RecruitmentContext> {
  const ctx = await resolveCycleContext(cycleId)
  if (!ctx) {
    await auditRecruitment({
      eventType: "action.denied",
      actor: { email: "unknown" },
      cycleId,
      reason: `Unauthenticated or unassigned caller attempted ${action}.`,
      meta: { action },
      outcome: "REJECTED",
    })
    throw new RecruitmentDenied(action, "not-assigned")
  }
  try {
    assertCan(ctx, action)
  } catch (err) {
    await recordDenied(ctx, action, err)
    throw err
  }
  return ctx
}

export async function recordDenied(
  ctx: RecruitmentContext,
  action: RecruitmentAction,
  err: unknown,
): Promise<void> {
  await auditRecruitment({
    eventType: "action.denied",
    actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
    cycleId: ctx.cycle.id,
    reason:
      err instanceof RecruitmentDenied && err.detail === "cycle-state"
        ? `Cycle state ${ctx.cycle.state} forbids ${action}.`
        : `Role ${ctx.role} may not ${action}.`,
    meta: { action, cycleState: ctx.cycle.state, role: ctx.role, implicit: ctx.implicit },
    outcome: "REJECTED",
  })
}

// ---------------------------------------------------------------------------
// Resource scoping
// ---------------------------------------------------------------------------

// A JC may only touch groups they are actually assigned to; maintainers see the
// groups they staff plus any they created; admins see everything. Without this, a
// correct capability check would still leak every group in the cycle to every JC.
export async function requireGroupAccess(
  groupId: string,
  action: RecruitmentAction,
): Promise<{ ctx: RecruitmentContext; canEvaluate: boolean }> {
  const group = await prisma.recruitmentGroup.findUnique({
    where: { id: groupId },
    select: { id: true, cycleId: true },
  })
  if (!group) throw new RecruitmentDenied(action, "not-assigned")

  const ctx = await requireRecruitmentAction(group.cycleId, action)

  if (ctx.role === "ADMIN") return { ctx, canEvaluate: true }

  const assignment = await prisma.recruitmentStaffAssignment.findFirst({
    where: { groupId, member: { userId: ctx.userId, isActive: true } },
    select: { canEvaluate: true, role: true },
  })

  if (!assignment) {
    // Maintainers may still administer groups in their cycle they don't staff;
    // JCs may not see anything they were not put on.
    if (ctx.role === "MAINTAINER" && action !== "evaluation.submit" && action !== "evaluation.draft") {
      return { ctx, canEvaluate: false }
    }
    await recordDenied(ctx, action, new RecruitmentDenied(action, "not-assigned"))
    throw new RecruitmentDenied(action, "not-assigned")
  }

  // A JC needs the explicit canEvaluate flag to score at all: "can submit
  // evaluations only where explicitly permitted".
  const canEvaluate = ctx.role === "MAINTAINER" ? true : assignment.canEvaluate
  if ((action === "evaluation.submit" || action === "evaluation.draft") && !canEvaluate) {
    await recordDenied(ctx, action, new RecruitmentDenied(action, "not-permitted"))
    throw new RecruitmentDenied(action, "not-permitted")
  }

  return { ctx, canEvaluate }
}

// Group ids this actor may see, for list pages. `null` means "no restriction".
export async function visibleGroupIds(ctx: RecruitmentContext): Promise<string[] | null> {
  if (ctx.role === "ADMIN" || ctx.role === "MAINTAINER") return null
  const rows = await prisma.recruitmentStaffAssignment.findMany({
    where: { member: { userId: ctx.userId, cycleId: ctx.cycle.id, isActive: true } },
    select: { groupId: true },
  })
  return rows.map((r) => r.groupId)
}

export { isCycleLive }
