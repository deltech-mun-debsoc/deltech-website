import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { RecruitmentDenied, mayPerform, requireGroupAccess } from "@/lib/recruitment/authz"
import { criteriaFor, parseCycleConfig } from "@/lib/schemas/recruitment"
import { atLeast, can } from "@/lib/recruitment/permissions"
import {
  gdWasBypassed,
  type CandidateResultName,
  type CandidateStageName,
} from "@/lib/recruitment/transitions"
import { t } from "@/content/strings"
import type { SessionDisplayState } from "@/lib/recruitment/session"
import { RecruitmentPageHeader } from "../../_components/page-header"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { SessionConsole } from "./session-console"
import { InterviewConsole } from "./interview-console"
import { getGroupConsole } from "../_lib/queries"

// Shared by /recruitment/gd/[groupId] and /recruitment/pi/[groupId]. The scoping
// guard runs first: a JC opening a group they were not assigned to is bounced,
// rather than shown data and refused on save.
//
// The two rounds share their data (getGroupConsole) but not their layout: a GD is a
// roster, an interview is one person.
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

  // Interviews are not a Junior Council surface, and that has to hold on the
  // console too. requireGroupAccess above already refuses a JC on a PI group; this
  // redirect is what turns that refusal into a redirect rather than an error page.
  if (kind === "PI" && !can(ctx.role, "interview.conduct")) redirect("/recruitment")

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

  const permissions = {
    control: mayPerform(ctx, "session.start"),
    // Both the capability AND the per-group grant must hold: a JC only scores
    // where a maintainer ticked "may score". The tier test is the role, not
    // `evaluation.viewOthers` -- JCs hold that now, and reading it here would
    // have collapsed the whole expression to true and killed the grant.
    evaluate: (canEvaluate || atLeast(ctx.role, "MAINTAINER")) && mayPerform(ctx, "evaluation.submit"),
    revise: mayPerform(ctx, "evaluation.revise"),
    viewOthers: can(ctx.role, "evaluation.viewOthers"),
  }

  const session = console_.session
    ? { ...console_.session, groupId: console_.group.id, kind }
    : null
  const displayState = console_.displayState as SessionDisplayState

  // An interview: one candidate, their own screen, and the GD verdict in front of
  // the interviewer rather than one tab away.
  const member = console_.members[0]
  if (kind === "PI" && member) {
    const c = member.candidate
    const bypassed = gdWasBypassed({
      stage: c.stage as CandidateStageName,
      result: c.result as CandidateResultName,
      gdRequired: c.gdRequired,
      piRequired: true,
    })

    // Two small reads on one candidate, only on the interview path.
    const [gdRecord, handoff] = await Promise.all([
      bypassed
        ? Promise.resolve([])
        : prisma.recruitmentEvaluation.findMany({
            where: { candidateId: c.id, kind: "GD", state: "SUBMITTED" },
            orderBy: { submittedAt: "asc" },
            // No evaluator relation on this model: names are resolved below, the
            // same way getGroupConsole does it.
            select: {
              id: true,
              overall: true,
              recommendation: true,
              remarks: true,
              evaluatorId: true,
            },
          }),
      bypassed
        ? prisma.recruitmentHandoff.findFirst({
            where: { candidateId: c.id, bypass: true },
            orderBy: { createdAt: "desc" },
            select: { reason: true },
          })
        : Promise.resolve(null),
    ])

    const evaluators = gdRecord.length
      ? await prisma.user.findMany({
          where: { id: { in: [...new Set(gdRecord.map((e) => e.evaluatorId))] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const evaluatorById = new Map(evaluators.map((u) => [u.id, u]))

    return (
      <div className="space-y-6">
        <LiveRefresh cycleId={ctx.cycle.id} pollMs={60000} />

        <RecruitmentPageHeader
          eyebrow={t("recruitment.groups.titlePi")}
          title={c.fullName}
          description={console_.group.notes ?? undefined}
        />

        <InterviewConsole
          cycleId={ctx.cycle.id}
          session={session}
          displayState={displayState}
          member={member}
          criteria={criteria}
          viewerId={ctx.userId}
          staff={console_.staff}
          gdRecord={gdRecord.map((e) => ({
            id: e.id,
            overall: e.overall,
            recommendation: e.recommendation,
            remarks: e.remarks,
            evaluatorName:
              evaluatorById.get(e.evaluatorId)?.name ??
              evaluatorById.get(e.evaluatorId)?.email ??
              null,
          }))}
          gdBypassed={bypassed}
          gdBypassReason={handoff?.reason ?? null}
          permissions={permissions}
        />
      </div>
    )
  }

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
        session={session}
        displayState={displayState}
        members={console_.members}
        criteria={criteria}
        viewerId={ctx.userId}
        staff={console_.staff}
        permissions={permissions}
      />
    </div>
  )
}
