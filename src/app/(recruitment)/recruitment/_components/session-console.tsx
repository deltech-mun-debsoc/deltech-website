"use client"

import Link from "next/link"
import { TriangleAlert, Users } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import type { EvaluationCriterion } from "@/lib/schemas/recruitment"
import type { SessionDisplayState } from "@/lib/recruitment/session"
import { StageBadge } from "../../_components/status-badges"
import { useRecruitmentLive } from "@/components/recruitment/use-recruitment-live"
import type { SerializedSession } from "../session-actions"
import { SessionControls } from "./session-controls"
import { EvaluationForm, type ConsoleEvaluation } from "./evaluation-form"

export interface ConsoleMember {
  id: string
  previousGdAttempts: number
  candidate: {
    id: string
    fullName: string
    email: string
    year: string | null
    branch: string | null
    stage: string
    result: string
  }
  evaluations: ConsoleEvaluation[]
}

export interface SessionConsoleProps {
  cycleId: string
  group: { id: string; kind: "GD" | "PI"; title: string }
  session: SerializedSession | null
  displayState: SessionDisplayState
  members: ConsoleMember[]
  criteria: EvaluationCriterion[]
  viewerId: string
  // Who ran this panel. The audit record of the round, and the question you are
  // actually asking when you open a finished console from an audit-trail link.
  staff: { userId: string; name: string | null; email: string; role: string }[]
  permissions: {
    control: boolean
    evaluate: boolean
    revise: boolean
    viewOthers: boolean
  }
}

// The group discussion console: server-authoritative timer, roster and scoring.
//
// An interview is one person and gets its own screen (InterviewConsole); this one
// is the roster case. They share SessionControls, which carries the clock and the
// conflict-adoption logic.
export function SessionConsole({
  cycleId,
  group,
  session,
  displayState,
  members,
  criteria,
  viewerId,
  staff,
  permissions,
}: SessionConsoleProps) {
  const { notify } = useRecruitmentLive(cycleId)

  return (
    <div className="space-y-6">
      <SessionControls
        cycleId={cycleId}
        session={session}
        displayState={displayState}
        viewerId={viewerId}
        canControl={permissions.control}
      >
        {staff.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("recruitment.groups.staffLabel")}:{" "}
            {staff.map((s) => s.name ?? s.email).join(", ")}
          </p>
        )}
      </SessionControls>

      <section className="space-y-3">
        <h2 className="section-label flex items-center gap-2">
          <Users className="size-3.5" />
          {t("recruitment.groups.candidateCount", { count: members.length })}
        </h2>

        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.id}>
              <Card className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{m.candidate.fullName}</p>
                      <StageBadge stage={m.candidate.stage} />
                      {m.previousGdAttempts > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--signal-soft)] px-2 py-0.5 text-xs text-[var(--ink-soft)]">
                          <TriangleAlert className="size-3" />
                          {t("recruitment.dossier.previousGdAttempts", {
                            count: m.previousGdAttempts,
                          })}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[m.candidate.branch, m.candidate.year, m.candidate.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/recruitment/candidates/${m.candidate.id}`}
                      prefetch
                      className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                    >
                      {t("recruitment.candidates.openDossier")}
                    </Link>
                  </div>
                </div>

                <EvaluationForm
                  cycleId={cycleId}
                  candidateId={m.candidate.id}
                  candidateName={m.candidate.fullName}
                  sessionId={session?.id ?? null}
                  kind={group.kind}
                  criteria={criteria}
                  evaluations={m.evaluations}
                  viewerId={viewerId}
                  canEvaluate={permissions.evaluate}
                  canRevise={permissions.revise}
                  canViewOthers={permissions.viewOthers}
                  onSaved={() => notify("evaluation")}
                />
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
