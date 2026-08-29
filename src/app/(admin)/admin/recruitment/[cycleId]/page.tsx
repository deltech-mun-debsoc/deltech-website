import { notFound } from "next/navigation"
import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { parseCycleConfig } from "@/lib/schemas/recruitment"
import { CYCLE_TRANSITIONS, type CycleStateName } from "@/lib/recruitment/permissions"
import { Card } from "@/components/ui/card"
import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { CycleStateControls } from "../_components/cycle-state-controls"
import { CycleConfigForm } from "../_components/cycle-config-form"
import { CycleStaffPanel } from "../_components/cycle-staff-panel"
import { FinalisationPanel } from "../_components/finalisation-panel"

// Cycle configuration + finalisation. Read access is staff-wide (a MAINTAINER may
// look), but every mutation on this page is gated by requireRecruitmentAction with
// an ADMIN-only capability: see scripts/check-role-guards.ts.
export default async function CycleConfigPage({
  params,
}: {
  params: Promise<{ cycleId: string }>
}) {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const { cycleId } = await params

  const cycle = await prisma.recruitmentCycle.findUnique({
    where: { id: cycleId },
    include: {
      members: {
        orderBy: [{ isActive: "desc" }, { assignedAt: "asc" }],
        include: { user: { select: { name: true, email: true, role: true } } },
      },
    },
  })
  if (!cycle) notFound()

  const config = parseCycleConfig(cycle.config)

  // Selected candidates who have not yet been added to the society. Finalisation
  // and membership are separate steps, so this is a real queue.
  const [selected, awaiting, recruited] = await Promise.all([
    prisma.recruitmentCandidate.findMany({
      where: { cycleId, result: "SELECTED" },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        recruitedUserId: true,
        decidedAt: true,
      },
    }),
    prisma.recruitmentCandidate.findMany({
      where: { cycleId, result: "SELECTED", recruitedUserId: null },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true, stage: true },
    }),
    prisma.recruitmentCandidate.findMany({
      where: { cycleId, recruitedUserId: { not: null } },
      orderBy: { recruitedAt: "desc" },
      take: 50,
      select: {
        id: true,
        fullName: true,
        email: true,
        societyRole: true,
        recruitedAt: true,
      },
    }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("recruitment.control.title")} title={cycle.name} description={cycle.slug}>
        <Link
          href="/admin/recruitment"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          {t("common.back")}
        </Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <CycleConfigForm
            cycleId={cycle.id}
            version={cycle.version}
            config={config}
            disabled={!isAdmin}
          />

          <FinalisationPanel
            selected={selected.map((candidate) => ({
              ...candidate,
              addedToSociety: candidate.recruitedUserId !== null,
              decidedAt: candidate.decidedAt?.toISOString() ?? null,
            }))}
            awaiting={awaiting}
            recruited={recruited.map((r) => ({
              ...r,
              recruitedAt: r.recruitedAt?.toISOString() ?? null,
            }))}
            societyRoles={config.societyRoles}
            recruitmentComplete={cycle.state === "COMPLETED" || cycle.state === "ARCHIVED"}
            disabled={!isAdmin}
          />
        </div>

        <aside className="space-y-6">
          <Card className="space-y-3 p-4">
            <h2 className="section-label">
              {t("recruitment.control.stateLabel")}
            </h2>
            <CycleStateControls
              cycleId={cycle.id}
              state={cycle.state as CycleStateName}
              version={cycle.version}
              // The state machine decides what is offered, so the UI can never
              // present a transition the server would refuse.
              options={CYCLE_TRANSITIONS[cycle.state as CycleStateName] ?? []}
              disabled={!isAdmin}
            />
          </Card>

          <CycleStaffPanel
            cycleId={cycle.id}
            members={cycle.members.map((m) => ({
              id: m.id,
              role: m.role,
              isActive: m.isActive,
              name: m.user.name,
              email: m.user.email,
              appRole: m.user.role,
            }))}
            disabled={!isAdmin}
          />
        </aside>
      </div>
    </div>
  )
}
