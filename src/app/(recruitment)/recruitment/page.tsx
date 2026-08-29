import Link from "next/link"
import { requireRecruitmentAccess, resolveCycleContext } from "@/lib/recruitment/authz"
import { t } from "@/content/strings"
import { Card } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { RecruitmentPageHeader } from "../_components/page-header"
import { SessionTimer } from "../_components/session-timer"
import { SessionStateBadge, StageBadge } from "../_components/status-badges"
import { LiveRefresh } from "@/components/recruitment/live-refresh"
import { getMyDesk } from "./_lib/queries"

// "My desk": what this person is assigned to right now. For a JC this is the whole
// application: their groups, their timers, and the scores they still owe.
export default async function RecruitmentOverviewPage() {
  const { cycle } = await requireRecruitmentAccess()
  // The layout already renders an empty state when there is no live cycle.
  if (!cycle) return null

  const ctx = await resolveCycleContext(cycle.id)
  if (!ctx) return null

  const { sessions, owed } = await getMyDesk(ctx)

  return (
    <div className="space-y-6">
      <LiveRefresh cycleId={cycle.id} />

      <RecruitmentPageHeader
        eyebrow={cycle.name}
        title={t("recruitment.overview.title")}
        description={t("recruitment.overview.description")}
      />

      <section className="space-y-3">
        <h2 className="section-label">
          {t("recruitment.overview.upcoming")}
        </h2>

        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("recruitment.overview.noSessions")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Card className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.groupTitle}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("recruitment.groups.candidateCount", { count: s.candidateCount })} ·{" "}
                        {t("recruitment.groups.evaluationCount", { count: s.evaluationCount })}
                      </p>
                    </div>
                    <SessionStateBadge state={s.displayState as "ACTIVE"} />
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="data-label text-muted-foreground">
                        {t("recruitment.session.elapsed")}
                      </p>
                      <SessionTimer session={s.timer} className="text-2xl" />
                    </div>
                    <Link
                      href={`/recruitment/${s.kind === "GD" ? "gd" : "pi"}/${s.groupId}`}
                      className={cn(buttonVariants({ size: "sm" }))}
                    >
                      {t("recruitment.overview.openConsole")}
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-label">
          {t("recruitment.overview.pendingEvaluations")}
        </h2>

        {owed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("recruitment.overview.allDone")}</p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-md border border-border/70">
            {owed.map((o) => (
              <li key={o.groupMemberId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{o.candidateName}</p>
                  <p className="truncate text-xs text-muted-foreground">{o.groupTitle}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StageBadge stage={o.stage} />
                  <Link
                    href={`/recruitment/${o.kind === "GD" ? "gd" : "pi"}/${o.groupId}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    {t("recruitment.evaluation.title")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
