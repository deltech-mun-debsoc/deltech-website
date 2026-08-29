"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Pause, Play, Square, TriangleAlert, Users } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import type { EvaluationCriterion } from "@/lib/schemas/recruitment"
import type { SessionDisplayState } from "@/lib/recruitment/session"
import { SessionTimer } from "../../_components/session-timer"
import { AttendanceBadge, SessionStateBadge, StageBadge } from "../../_components/status-badges"
import { useRecruitmentLive } from "@/components/recruitment/use-recruitment-live"
import {
  abortSession,
  finishSession,
  pauseSession,
  resumeSession,
  setAttendance,
  startSession,
  takeSessionControl,
  type SerializedSession,
} from "../session-actions"
import { EvaluationForm, type ConsoleEvaluation } from "./evaluation-form"

export interface ConsoleMember {
  id: string
  attendance: string
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
  permissions: {
    control: boolean
    evaluate: boolean
    revise: boolean
    viewOthers: boolean
    reopen: boolean
  }
}

// The live session console: server-authoritative timer, roster, attendance and
// per-evaluator scoring.
//
// Every control action returns the server's current session state. On conflict we
// adopt that state rather than retrying, which is what makes a queued click from a
// stale tab lose instead of overwriting newer state.
export function SessionConsole({
  cycleId,
  group,
  session: initialSession,
  displayState,
  members,
  criteria,
  viewerId,
  permissions,
}: SessionConsoleProps) {
  const router = useRouter()
  const { notify } = useRecruitmentLive(cycleId)
  const [session, setSession] = useState(initialSession)
  const [pending, startTransition] = useTransition()

  // The server is the source of truth: whenever a fresh payload arrives from an
  // RSC refresh, it replaces whatever the client was holding.
  useEffect(() => setSession(initialSession), [initialSession])

  function run(
    action: () => Promise<
      { ok: true; idempotent: boolean; session: SerializedSession } | { ok: false; error: string; conflict?: SerializedSession }
    >,
    successMessage?: string,
    // What to say when the server reports the change had already been applied,
    // a retry, a second tab, or another maintainer getting there first.
    idempotentMessage?: string,
  ) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        setSession(result.session)
        // An idempotent outcome is a success, not an error: say so quietly.
        if (result.idempotent) toast.info(idempotentMessage ?? t("recruitment.session.alreadyRunning"))
        else if (successMessage) toast.success(successMessage)
        notify("session")
        router.refresh()
        return
      }
      toast.error(result.error)
      if (result.conflict) {
        // Adopt the newer server state so the UI stops lying immediately.
        setSession(result.conflict)
        router.refresh()
      }
    })
  }

  const state = session?.state ?? "NOT_STARTED"
  const controlledByOther =
    !!session?.controllerId && session.controllerId !== viewerId && state !== "COMPLETED" && state !== "ABORTED"

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SessionStateBadge state={displayState} />
              {session && session.attempt > 1 && (
                <span className="text-xs text-muted-foreground">#{session.attempt}</span>
              )}
            </div>
            <p className="mt-2 data-label text-muted-foreground">
              {t("recruitment.session.elapsed")}
            </p>
            {session ? (
              <SessionTimer session={session} className="text-4xl" />
            ) : (
              <p className="text-2xl text-muted-foreground">{t("recruitment.session.notStartedYet")}</p>
            )}
            {session?.startedAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("recruitment.session.startedAt")}:{" "}
                <time dateTime={session.startedAt}>
                  {session.startedAt.slice(0, 19).replace("T", " ")}
                </time>
              </p>
            )}
          </div>

          {permissions.control && session && (
            <div className="flex flex-wrap items-center gap-2">
              {state === "NOT_STARTED" && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => startSession({ sessionId: session.id, expectedVersion: session.version }),
                      t("recruitment.session.start"),
                    )
                  }
                >
                  <Play className="size-3.5" />
                  {t("recruitment.session.start")}
                </Button>
              )}

              {state === "ACTIVE" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={pending}
                  onClick={() =>
                    run(() => pauseSession({ sessionId: session.id, expectedVersion: session.version }))
                  }
                >
                  <Pause className="size-3.5" />
                  {t("recruitment.session.pause")}
                </Button>
              )}

              {state === "PAUSED" && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={pending}
                  onClick={() =>
                    run(() => resumeSession({ sessionId: session.id, expectedVersion: session.version }))
                  }
                >
                  <Play className="size-3.5" />
                  {t("recruitment.session.resume")}
                </Button>
              )}

              {(state === "ACTIVE" || state === "PAUSED") && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(t("recruitment.session.confirmFinish"))) return
                      run(
                        () => finishSession({ sessionId: session.id, expectedVersion: session.version }),
                        t("recruitment.session.finish"),
                        t("recruitment.session.alreadyFinished"),
                      )
                    }}
                  >
                    <Square className="size-3.5" />
                    {t("recruitment.session.finish")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={pending}
                    onClick={() => {
                      const reason = prompt(t("recruitment.session.abortReasonLabel")) ?? ""
                      if (!reason.trim()) return
                      run(() =>
                        abortSession({
                          sessionId: session.id,
                          expectedVersion: session.version,
                          reason: reason.trim(),
                        }),
                      )
                    }}
                  >
                    {t("recruitment.session.abort")}
                  </Button>
                </>
              )}

              {/* Recovery path when the assigned maintainer disconnected: their
                  claim lapses and another maintainer can take over. */}
              {controlledByOther && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        takeSessionControl({ sessionId: session.id, expectedVersion: session.version }),
                      t("recruitment.session.takeControl"),
                    )
                  }
                >
                  {t("recruitment.session.takeControl")}
                </Button>
              )}
            </div>
          )}
        </div>

        {displayState === "STALE" && (
          <p className="mt-4 flex items-center gap-2 rounded-md bg-[var(--signal-soft)] px-3 py-2 text-sm text-[var(--ink-soft)]">
            <TriangleAlert className="size-4 shrink-0" />
            {t("recruitment.session.staleWarning")}
          </p>
        )}

        {controlledByOther && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("recruitment.session.controller")}: {session?.controllerId}
          </p>
        )}
      </Card>

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
                      <AttendanceBadge attendance={m.attendance} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[m.candidate.branch, m.candidate.year, m.candidate.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Attendance is first come, first served: a seated candidate
                        is present unless someone marks them absent. The four-state
                        dropdown was ceremony nobody used mid-session. */}
                    <Button
                      variant={m.attendance === "ABSENT" ? "outline" : "ghost"}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await setAttendance({
                            groupMemberId: m.id,
                            attendance: m.attendance === "ABSENT" ? "PRESENT" : "ABSENT",
                          })
                          if (!result.ok) toast.error(result.error ?? t("recruitment.errors.generic"))
                          else {
                            notify("candidate")
                            router.refresh()
                          }
                        })
                      }
                    >
                      {t(
                        m.attendance === "ABSENT"
                          ? "recruitment.attendance.markPresent"
                          : "recruitment.attendance.markAbsent",
                      )}
                    </Button>

                    <Link
                      href={`/recruitment/candidates/${m.candidate.id}`}
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
                  canEvaluate={permissions.evaluate && m.attendance !== "ABSENT"}
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
