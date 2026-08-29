import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { RecruitmentDenied, mayPerform, requireGroupAccess } from "@/lib/recruitment/authz"
import { criteriaFor, parseCycleConfig } from "@/lib/schemas/recruitment"
import { can } from "@/lib/recruitment/permissions"
import { t } from "@/content/strings"
import type { SessionDisplayState } from "@/lib/recruitment/session"
import { RecruitmentPageHeader } from "../../_components/page-header"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { SessionConsole } from "./session-console"
import { getGroupConsole } from "../_lib/queries"

// Shared by /recruitment/gd/[groupId] and /recruitment/pi/[groupId]. The scoping
// guard runs first: a JC opening a group they were not assigned to is bounced,
// rather than shown data and refused on save.
export async function GroupConsolePage({
  groupId,
  kind,
}: {
  groupId: string
  kind: "GD" | "PI"
}) {
  let access
  try {
    // "session.view" is the read capability; requireGroupAccess additionally
    // restricts a JC to their own assignments.
    access = await requireGroupAccess(groupId, "session.view")
  } catch (err) {
    if (err instanceof RecruitmentDenied) redirect("/recruitment")
    throw err
  }
  const { ctx, canEvaluate } = access

  const group = await prisma.recruitmentGroup.findUnique({
    where: { id: groupId },
    select: { kind: true, cycleId: true },
  })
  // Guard against a GD id being opened under the PI route, which would otherwise
  // render an interview console over a GD roster.
  if (!group || group.kind !== kind || group.cycleId !== ctx.cycle.id) notFound()

  const console_ = await getGroupConsole(ctx, groupId)
  if (!console_) notFound()

  const criteria = criteriaFor(parseCycleConfig(ctx.cycle.config), kind)

  return (
    <div className="space-y-6">
      <LiveRefresh cycleId={ctx.cycle.id} pollMs={60000} />

      <RecruitmentPageHeader
        eyebrow={t(kind === "GD" ? "recruitment.groups.titleGd" : "recruitment.groups.titlePi")}
        title={console_.group.title}
        description={console_.group.notes ?? undefined}
      />

      <SessionConsole
        cycleId={ctx.cycle.id}
        group={{ id: console_.group.id, kind, title: console_.group.title }}
        session={
          console_.session
            ? { ...console_.session, groupId: console_.group.id, kind }
            : null
        }
        displayState={console_.displayState as SessionDisplayState}
        members={console_.members}
        panelists={console_.staff
          .filter((panelist) => panelist.canEvaluate)
          .map((panelist) => ({
            userId: panelist.userId,
            name: panelist.name,
            email: panelist.email,
          }))}
        criteria={criteria}
        viewerId={ctx.userId}
        permissions={{
          control: mayPerform(ctx, "session.start"),
          // Both the capability AND the per-group grant must hold: a JC only scores
          // where a maintainer ticked "may score".
          evaluate:
            (canEvaluate || can(ctx.role, "evaluation.viewOthers")) &&
            mayPerform(ctx, "evaluation.submit"),
          revise: mayPerform(ctx, "evaluation.revise"),
          viewOthers: can(ctx.role, "evaluation.viewOthers"),
          reopen: mayPerform(ctx, "session.reopen"),
        }}
      />
    </div>
  )
}
