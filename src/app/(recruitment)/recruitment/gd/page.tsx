import { ensureDerivedMembers, requireRecruitmentAccess, resolveCycleContext } from "@/lib/recruitment/authz"
import { mayPerform } from "@/lib/recruitment/authz"
import { t } from "@/content/strings"
import { prisma } from "@/lib/prisma"
import { RecruitmentPageHeader } from "../../_components/page-header"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { GroupList } from "../_components/group-list"
import { CreateGroupDialog } from "../_components/create-group-dialog"
import { LIVE_GROUP_STATES, PAST_GROUP_STATES, listGroups } from "../_lib/queries"

export default async function GdGroupsPage() {
  const { cycle } = await requireRecruitmentAccess()
  if (!cycle) return null

  const ctx = await resolveCycleContext(cycle.id)
  if (!ctx) return null

  const canCreate = mayPerform(ctx, "group.create")

  // Recruitment roles are derived from the app role, so the people who may staff a
  // group are not necessarily rows on this cycle yet. Backfill before reading the
  // picker below, or a JC invited this week could never be seated on a panel.
  if (canCreate) await ensureDerivedMembers(cycle.id, ctx.userId)

  const [live, past, assignable, staff] = await Promise.all([
    listGroups(ctx, "GD", LIVE_GROUP_STATES),
    listGroups(ctx, "GD", PAST_GROUP_STATES),
    // Candidates who still need a GD and are not already seated in one.
    canCreate
      ? prisma.recruitmentCandidate.findMany({
          where: {
            cycleId: cycle.id,
            gdRequired: true,
            stage: { in: ["INTAKE", "GD_PENDING"] },
            result: "PENDING",
            groupMemberships: { none: { kind: "GD", attendance: { not: "REASSIGNED" } } },
          },
          orderBy: { fullName: "asc" },
          select: { id: true, fullName: true, email: true, branch: true, year: true },
        })
      : Promise.resolve([]),
    canCreate
      ? prisma.recruitmentMember.findMany({
          where: { cycleId: cycle.id, isActive: true },
          include: { user: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
  ])

  return (
    <div className="space-y-6">
      <LiveRefresh cycleId={cycle.id} />

      <RecruitmentPageHeader
        eyebrow={cycle.name}
        title={t("recruitment.groups.titleGd")}
        description={t("recruitment.groups.descriptionGd")}
      >
        {canCreate && (
          <CreateGroupDialog
            cycleId={cycle.id}
            kind="GD"
            candidates={assignable}
            staff={staff.map((m) => ({
              memberId: m.id,
              role: m.role,
              name: m.user.name,
              email: m.user.email,
            }))}
          />
        )}
      </RecruitmentPageHeader>

      <GroupList live={live} past={past} kind="GD" scoped={ctx.role === "JC"} />
    </div>
  )
}
