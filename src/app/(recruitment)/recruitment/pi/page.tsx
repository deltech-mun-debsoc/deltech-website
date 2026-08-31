import { redirect } from "next/navigation"
import { requireRecruitmentAccess, resolveCycleContext, mayPerform } from "@/lib/recruitment/authz"
import { can } from "@/lib/recruitment/permissions"
import { t } from "@/content/strings"
import { prisma } from "@/lib/prisma"
import { RecruitmentPageHeader } from "../../_components/page-header"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { PiQueue } from "../_components/pi-queue"

// A personal interview is one candidate, so this page is a queue of PEOPLE.
//
// The group underneath is still real (sessions, locks and the partial unique index
// all key off group membership) but it holds one candidate and is created by
// "Start interview" rather than assembled by hand. Previously this page listed
// groups and hid the candidates inside a create-group modal, which is why they
// appeared to vanish after a GD.
export default async function PiQueuePage() {
  const { cycle } = await requireRecruitmentAccess()
  if (!cycle) return null

  const ctx = await resolveCycleContext(cycle.id)
  if (!ctx) return null

  // Interviews are not a Junior Council surface. The nav hides this destination
  // for them, but the nav is cosmetic: without this guard a JC could type the URL
  // and read the name, email and branch of every candidate in the queue, which is
  // not scoped by visibleGroupIds the way the candidate list is.
  if (!can(ctx.role, "interview.conduct")) redirect("/recruitment")

  // Starting an interview creates its PI group, but the capability to test is
  // conducting one -- group.create is every JC's now, and createGroup demands
  // interview.conduct for a PI group regardless of what this button decides.
  const canStart = mayPerform(ctx, "interview.conduct")

  const [waiting, live, past, starterMembership] = await Promise.all([
    // Anyone past GD: completed, bypassed, or configured not to need one. This is
    // the query that has to work for direct-to-PI candidates.
    prisma.recruitmentCandidate.findMany({
      where: {
        cycleId: cycle.id,
        piRequired: true,
        stage: { in: ["GD_COMPLETE", "GD_BYPASSED", "PI_PENDING"] },
        result: { in: ["PENDING", "ON_HOLD"] },
        groupMemberships: { none: { kind: "PI", attendance: { not: "REASSIGNED" } } },
      },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true, branch: true, year: true, stage: true },
    }),
    // Interviews already under way, so a half-finished one can be resumed rather
    // than started twice.
    prisma.recruitmentGroup.findMany({
      where: { cycleId: cycle.id, kind: "PI", state: { in: ["DRAFT", "READY", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        state: true,
        members: {
          where: { attendance: { not: "REASSIGNED" } },
          select: { candidate: { select: { fullName: true } } },
          take: 1,
        },
      },
    }),
    // Interviews already done. Without this the finished ones were unreachable:
    // the group leaves DRAFT/READY/RUNNING on finish, and the candidate is filtered
    // out of `waiting` by their new PI membership, so nothing linked to them at all
    // and a mis-scored interview could not be corrected.
    prisma.recruitmentGroup.findMany({
      where: { cycleId: cycle.id, kind: "PI", state: "DONE" },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        members: {
          where: { attendance: { not: "REASSIGNED" } },
          select: { candidate: { select: { id: true, fullName: true, stage: true, result: true } } },
          take: 1,
        },
        sessions: {
          orderBy: { attempt: "desc" },
          take: 1,
          select: { endedAt: true, _count: { select: { evaluations: true } } },
        },
      },
    }),
    prisma.recruitmentMember.findUnique({
      where: { cycleId_userId: { cycleId: cycle.id, userId: ctx.userId } },
      select: { id: true, isActive: true },
    }),
  ])

  return (
    <div className="space-y-6">
      <LiveRefresh cycleId={cycle.id} />

      <RecruitmentPageHeader
        eyebrow={cycle.name}
        title={t("recruitment.groups.titlePi")}
        description={t("recruitment.groups.descriptionPi")}
      />

      <PiQueue
        cycleId={cycle.id}
        candidates={waiting}
        inProgress={live.map((g) => ({
          groupId: g.id,
          candidateName: g.members[0]?.candidate.fullName ?? g.title,
          state: g.state,
        }))}
        past={past.map((g) => ({
          groupId: g.id,
          candidateId: g.members[0]?.candidate.id ?? null,
          candidateName: g.members[0]?.candidate.fullName ?? g.title,
          stage: g.members[0]?.candidate.stage ?? "PI_COMPLETE",
          result: g.members[0]?.candidate.result ?? "PENDING",
          endedAt: g.sessions[0]?.endedAt?.toISOString() ?? null,
          evaluationCount: g.sessions[0]?._count.evaluations ?? 0,
        }))}
        canStart={canStart}
        starterMemberId={starterMembership?.isActive ? starterMembership.id : null}
      />
    </div>
  )
}
