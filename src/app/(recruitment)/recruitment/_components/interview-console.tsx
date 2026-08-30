"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { FastForward } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import type { EvaluationCriterion } from "@/lib/schemas/recruitment"
import type { SessionDisplayState } from "@/lib/recruitment/session"
import { ResultBadge, StageBadge } from "../../_components/status-badges"
import { useRecruitmentLive } from "@/components/recruitment/use-recruitment-live"
import type { SerializedSession } from "../session-actions"
import { SessionControls } from "./session-controls"
import { EvaluationForm } from "./evaluation-form"
import type { ConsoleMember } from "./session-console"

export interface GdRecordEntry {
  id: string
  overall: number | null
  recommendation: string | null
  remarks: string | null
  evaluatorName: string | null
}

// A personal interview is one candidate, so it does not get the group console's
// roster chrome: no "1 candidates" heading, no list, no card wrapping a card.
//
// The candidate is the page. Their GD record sits beside the scoring form, which is
// what the interview page has always claimed to do ("with their full GD record in
// front of you") without ever doing it -- the interviewer had to open the dossier in
// another tab to see what the discussion panel thought.
export function InterviewConsole({
  cycleId,
  session,
  displayState,
  member,
  criteria,
  viewerId,
  staff,
  gdRecord,
  gdBypassed,
  gdBypassReason,
  permissions,
}: {
  cycleId: string
  session: SerializedSession | null
  displayState: SessionDisplayState
  member: ConsoleMember
  criteria: EvaluationCriterion[]
  viewerId: string
  // Who conducted the interview: the audit record of the round.
  staff: { userId: string; name: string | null; email: string; role: string }[]
  gdRecord: GdRecordEntry[]
  gdBypassed: boolean
  gdBypassReason: string | null
  permissions: { control: boolean; evaluate: boolean; revise: boolean; viewOthers: boolean }
}) {
  const router = useRouter()
  const { notify } = useRecruitmentLive(cycleId)
  const c = member.candidate

  return (
    <div className="space-y-6">
      <SessionControls
        cycleId={cycleId}
        session={session}
        displayState={displayState}
        viewerId={viewerId}
        canControl={permissions.control}
      >
        {/* Who you are interviewing, in the same card as the clock: on a one-person
            screen that is the only identity that matters. */}
        <div className="mt-3 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-heading text-xl leading-tight">{c.fullName}</p>
            <StageBadge stage={c.stage} />
            <ResultBadge result={c.result} />
          </div>
          <p className="text-sm text-muted-foreground">
            {[c.branch, c.year, c.email].filter(Boolean).join(" · ")}
          </p>
          <Link
            href={`/recruitment/candidates/${c.id}`}
            prefetch
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-3")}
          >
            {t("recruitment.groups.openDossierFull")}
          </Link>
          {staff.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("recruitment.groups.staffLabel")}:{" "}
              {staff.map((s) => s.name ?? s.email).join(", ")}
            </p>
          )}
        </div>
      </SessionControls>

      <section className="space-y-3">
        <h2 className="section-label">{t("recruitment.groups.gdRecord")}</h2>
        <Card className="p-4">
          {gdBypassed ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <FastForward className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t("recruitment.groups.gdRecordBypassed")}
                {gdBypassReason && <> {gdBypassReason}</>}
              </span>
            </p>
          ) : gdRecord.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("recruitment.groups.gdRecordEmpty")}
            </p>
          ) : (
            <ul className="space-y-3">
              {gdRecord.map((e) => (
                <li key={e.id} className="space-y-1 text-sm">
                  <p className="flex flex-wrap items-baseline gap-2">
                    {e.overall != null && (
                      <strong className="font-mono tabular-nums">
                        {t("recruitment.evaluation.overallOutOf", { score: e.overall })}
                      </strong>
                    )}
                    {e.recommendation && (
                      <span className="text-muted-foreground">
                        {t(`recruitment.recommendation.${e.recommendation}` as StringKey)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {t("recruitment.evaluation.submittedBy", { name: e.evaluatorName ?? "Unknown" })}
                    </span>
                  </p>
                  {e.remarks && <p className="leading-relaxed">{e.remarks}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* No heading here: EvaluationForm carries its own, and two of them stacked
          read as a rendering bug. */}
      <section>
        <EvaluationForm
          cycleId={cycleId}
          candidateId={c.id}
          candidateName={c.fullName}
          sessionId={session?.id ?? null}
          kind="PI"
          criteria={criteria}
          evaluations={member.evaluations}
          viewerId={viewerId}
          canEvaluate={permissions.evaluate}
          canRevise={permissions.revise}
          canViewOthers={permissions.viewOthers}
          onSaved={() => notify("evaluation")}
          // An interview is one person: once the score is saved there is nothing
          // else on this screen to do, so hand them back to the queue rather than
          // making them find their own way. A GD console passes nothing here.
          onRevised={() => router.push("/recruitment/pi")}
        />
      </section>
    </div>
  )
}
