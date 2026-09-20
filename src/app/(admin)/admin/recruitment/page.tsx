import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
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

const CYCLE_STATE: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  FINALISATION: "Finalising",
  COMPLETED: "Completed",
  ABORTED: "Stopped",
}

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

  const inSessionNow = counts ? counts.gdActive + counts.piActive : 0
  const journey = counts
    ? [
        { label: "Waiting for a GD", count: counts.unassignedGd + counts.gdPending, tone: "bg-amber-500" },
        { label: "Through the GD", count: counts.gdComplete + counts.gdBypassed, tone: "bg-sky-500" },
        { label: "Interviewed", count: counts.piComplete, tone: "bg-violet-500" },
        { label: "Decided", count: counts.selected + counts.rejected + counts.withdrawn, tone: "bg-emerald-500" },
      ].filter((stage) => stage.count > 0)
    : []
  // Only what someone has to act on. A zero is not news.
  const needsYou = counts
    ? [
        { label: "Not in a GD group yet", count: counts.unassignedGd, warn: false },
        { label: "Not in an interview group yet", count: counts.unassignedPi, warn: false },
        { label: "Evaluations still owed", count: counts.evaluationPending, warn: false },
        { label: "Sessions running with nobody in them", count: counts.staleSessions, warn: true },
        { label: "Rows that failed to import", count: counts.importErrors, warn: true },
        { label: "Selected, not yet added to the society", count: counts.awaitingRecruitment, warn: false },
        { label: "On hold", count: counts.onHold, warn: false },
      ].filter((item) => item.count > 0)
    : []

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
                        {CYCLE_STATE[c.state] ?? c.state}
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

            <div className="editorial-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  <span className="font-heading text-3xl tabular-nums text-foreground">{counts.total}</span>
                  {counts.total === 1 ? " candidate" : " candidates"}
                </p>
                {inSessionNow > 0 && (
                  <p className="text-sm font-medium text-[var(--teal-700)]">
                    {`${inSessionNow} in a session right now`}
                  </p>
                )}
              </div>
              {journey.length > 0 && (
                <>
                  <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-muted">
                    {journey.map((stage) => (
                      <div
                        key={stage.label}
                        className={cn(stage.tone, "h-full")}
                        style={{ width: `${(stage.count / Math.max(counts.total, 1)) * 100}%` }}
                      />
                    ))}
                  </div>
                  <ul className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {journey.map((stage) => (
                      <li key={stage.label} className="flex items-center gap-2.5 text-sm">
                        <span className={cn("size-2.5 rounded-full", stage.tone)} />
                        <span className="text-muted-foreground">{stage.label}</span>
                        <span className="ml-auto font-medium tabular-nums">{stage.count}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {counts.selected + counts.rejected > 0 && (
                <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                  {`${counts.selected} selected · ${counts.rejected} not selected`}
                </p>
              )}
            </div>

            {needsYou.length > 0 && (
              <div className="editorial-card p-5">
                <h3 className="font-heading text-lg">Needs you</h3>
                <ul className="mt-3 divide-y divide-border/60">
                  {needsYou.map((item) => (
                    <li key={item.label} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className={cn("size-2 rounded-full", item.warn ? "bg-red-500" : "bg-amber-500")} />
                      <span className="flex-1">{item.label}</span>
                      <span className="font-medium tabular-nums">{item.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>


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
