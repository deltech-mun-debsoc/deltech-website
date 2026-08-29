import { requireRecruitmentAccess, resolveCycleContext, mayPerform } from "@/lib/recruitment/authz"
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

  const canStart = mayPerform(ctx, "group.create")

  const [waiting, live, starterMembership] = await Promise.all([
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
        canStart={canStart}
        starterMemberId={starterMembership?.isActive ? starterMembership.id : null}
      />
    </div>
  )
}
