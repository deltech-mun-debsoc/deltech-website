import Link from "next/link"
import { ArrowUpRight, TriangleAlert } from "lucide-react"
import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { getCycleMonitorCounts, getMonitorSessions } from "@/lib/recruitment/monitor"
import { displayState, formatElapsed, elapsedMs } from "@/lib/recruitment/session"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { CreateCycleDialog } from "./_components/create-cycle-dialog"

// The admin dashboard's recruitment surface: control and monitoring only. The
// operational GD/PI consoles deliberately live at /recruitment, so a recruitment
// participant never needs to come in here.
export default async function AdminRecruitmentPage() {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"

  const cycles = await prisma.recruitmentCycle.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      state: true,
      openedAt: true,
      closedAt: true,
      _count: { select: { candidates: true, groups: true, members: true } },
    },
  })

  // Monitor the most recent live cycle, falling back to the newest one.
  const focus =
    cycles.find((c) => ["OPEN", "IN_PROGRESS", "PAUSED", "FINALISATION"].includes(c.state)) ??
    cycles[0]

  const [counts, sessions] = focus
    ? await Promise.all([getCycleMonitorCounts(focus.id), getMonitorSessions(focus.id, 20)])
    : [null, []]

  return (
    <div className="space-y-6">
      {focus && <LiveRefresh cycleId={focus.id} pollMs={15000} />}

      <PageHeader
        eyebrow={t("recruitment.brand")}
        title={t("recruitment.control.title")}
        description={t("recruitment.control.description")}
      >
        <Link
          href="/recruitment"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
        >
          {t("recruitment.control.openArea")}
          <ArrowUpRight className="size-3.5" />
        </Link>
        {isAdmin && <CreateCycleDialog />}
      </PageHeader>

      {/* ---- Cycles ---- */}
      <section className="space-y-3">
        <h2 className="section-label">
          {t("recruitment.control.cyclesTitle")}
        </h2>
        {cycles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("recruitment.control.noCycles")}</p>
        ) : (
          <ul className="space-y-2">
            {cycles.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{c.name}</p>
                      <Badge className="bg-secondary font-normal text-secondary-foreground">
                        {c.state}
                      </Badge>
                      {focus?.id === c.id && (
                        <Badge className="bg-[var(--teal-100)] font-normal text-[var(--teal-700)]">
                          {t("recruitment.monitor.live")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("recruitment.control.candidatesLabel")}: {c._count.candidates} ·{" "}
                      {t("recruitment.control.groupsLabel")}: {c._count.groups} ·{" "}
                      {t("recruitment.control.membersLabel")}: {c._count.members}
                    </p>
                  </div>
                  <Link
                    href={`/admin/recruitment/${c.id}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    {t("recruitment.control.configure")}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Live counts, all derived from database state ---- */}
      {counts && focus && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="section-label">
                {t("recruitment.control.monitorTitle")} · {focus.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("recruitment.monitor.updated", {
                  time: counts.serverNow.toISOString().slice(11, 19),
                })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="recruitment.monitor.total" value={counts.total} />
              <Stat label="recruitment.monitor.unassignedGd" value={counts.unassignedGd} />
              <Stat label="recruitment.monitor.gdPending" value={counts.gdPending} />
              <Stat label="recruitment.monitor.gdActive" value={counts.gdActive} emphasis />
              <Stat label="recruitment.monitor.gdComplete" value={counts.gdComplete} />
              <Stat label="recruitment.monitor.gdBypassed" value={counts.gdBypassed} />
              <Stat label="recruitment.monitor.unassignedPi" value={counts.unassignedPi} />
              <Stat label="recruitment.monitor.piPending" value={counts.piPending} />
              <Stat label="recruitment.monitor.piActive" value={counts.piActive} emphasis />
              <Stat label="recruitment.monitor.piComplete" value={counts.piComplete} />
              <Stat label="recruitment.monitor.evaluationPending" value={counts.evaluationPending} />
              <Stat label="recruitment.monitor.onHold" value={counts.onHold} />
              <Stat label="recruitment.monitor.selected" value={counts.selected} />
              <Stat label="recruitment.monitor.rejected" value={counts.rejected} />
              <Stat label="recruitment.monitor.withdrawn" value={counts.withdrawn} />
              <Stat
                label="recruitment.monitor.staleSessions"
                value={counts.staleSessions}
                warn={counts.staleSessions > 0}
              />
              <Stat
                label="recruitment.monitor.importErrors"
                value={counts.importErrors}
                warn={counts.importErrors > 0}
              />
              <Stat label="recruitment.control.awaitingRecruitment" value={counts.awaitingRecruitment} />
            </div>
          </section>

          {counts.staleSessions > 0 && (
            <Card className="flex items-start gap-3 bg-[var(--signal-soft)] p-4 text-[var(--ink-soft)]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  {t("recruitment.control.staleSessionsTitle")}
                </p>
                <p className="text-sm">
                  {t("recruitment.control.staleSessionsBody", { count: counts.staleSessions })}
                </p>
              </div>
            </Card>
          )}

          {/* ---- Live session table ---- */}
          {sessions.length > 0 && (
            <section className="space-y-3">
              <h2 className="section-label">
                {t("recruitment.monitor.sessionsActive")}
              </h2>
              <div className="overflow-x-auto rounded-md border border-border/70">
                <table className="w-full min-w-[46rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border/70 bg-card">
                      <th className="px-3 py-2 font-medium">{t("recruitment.control.groupsLabel")}</th>
                      <th className="px-3 py-2 font-medium">{t("recruitment.control.stateLabel")}</th>
                      <th className="px-3 py-2 font-medium">{t("recruitment.session.startedAt")}</th>
                      <th className="px-3 py-2 font-medium">{t("recruitment.session.elapsed")}</th>
                      <th className="px-3 py-2 font-medium">{t("recruitment.groups.staffLabel")}</th>
                      <th className="px-3 py-2 font-medium">
                        {t("recruitment.control.candidatesLabel")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("recruitment.evaluation.title")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("recruitment.session.lastActivity")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => {
                      const snapshot = {
                        id: s.id,
                        state: s.state as "ACTIVE",
                        version: s.version,
                        controllerId: s.controllerId,
                        controlExpiresAt: null,
                        startedAt: s.startedAt,
                        pausedAt: s.pausedAt,
                        endedAt: s.endedAt,
                        pausedMs: s.pausedMs,
                        lastActivityAt: s.lastActivityAt,
                      }
                      const shown = displayState(snapshot, counts.serverNow)
                      return (
                        <tr key={s.id} className="border-b border-border/40 last:border-0">
                          <td className="px-3 py-2">
                            {s.groupTitle}
                            <span className="ml-1.5 text-xs text-muted-foreground">{s.kind}</span>
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              className={cn(
                                "font-normal",
                                shown === "STALE"
                                  ? "bg-[var(--signal-soft)] text-[var(--ink-soft)]"
                                  : "bg-secondary text-secondary-foreground",
                              )}
                            >
                              {t(`recruitment.sessionState.${shown}` as StringKey)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {s.startedAt ? (
                              <time dateTime={s.startedAt.toISOString()}>
                                {s.startedAt.toISOString().slice(11, 19)}
                              </time>
                            ) : (
                              ", "
                            )}
                          </td>
                          {/* Exact duration from server timestamps, so the admin's
                              view cannot disagree with the operator's. */}
                          <td className="px-3 py-2 font-mono tabular-nums">
                            {s.startedAt ? formatElapsed(elapsedMs(snapshot, counts.serverNow)) : ", "}
                          </td>
                          <td className="max-w-48 truncate px-3 py-2 text-xs">
                            {s.staff.map((x) => x.name ?? x.email).join(", ") || ", "}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{s.candidateCount}</td>
                          <td className="px-3 py-2 tabular-nums">{s.evaluationCount}</td>
                          <td className="px-3 py-2 text-xs">
                            {s.lastActivityAt ? (
                              <time dateTime={s.lastActivityAt.toISOString()}>
                                {s.lastActivityAt.toISOString().slice(11, 19)}
                              </time>
                            ) : (
                              ", "
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  emphasis,
  warn,
}: {
  label: StringKey
  value: number
  emphasis?: boolean
  warn?: boolean
}) {
  return (
    <Card
      className={cn(
        "p-3",
        warn && value > 0 && "bg-[var(--signal-soft)] text-[var(--ink-soft)]",
        emphasis && value > 0 && "bg-[var(--teal-100)] text-[var(--teal-700)]",
      )}
    >
      <p className="data-label opacity-70">{t(label)}</p>
      <p className="mt-0.5 font-mono text-2xl tabular-nums">{value}</p>
    </Card>
  )
}
