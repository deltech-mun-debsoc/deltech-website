"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Pause, Play, Square, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { t } from "@/content/strings"
import {
  optimisticSessionTransition,
  type OptimisticSessionAction,
  type SessionDisplayState,
} from "@/lib/recruitment/session"
import { SessionTimer } from "../../_components/session-timer"
import { SessionStateBadge } from "../../_components/status-badges"
import { useRecruitmentLive } from "@/components/recruitment/use-recruitment-live"
import {
  abortSession,
  finishSession,
  pauseSession,
  resumeSession,
  startSession,
  type SerializedSession,
} from "../session-actions"

// The session clock and its lifecycle buttons.
//
// Extracted from the group console so the interview console can reuse it verbatim
// rather than growing a second copy: this is the component holding the reversible
// optimistic transitions and conflict-adoption behaviour, and two of those would
// drift.
//
// Every control action returns the server's current session state. On conflict we
// adopt that state rather than retrying, which is what makes a queued click from a
// stale tab lose instead of overwriting newer state.
export function SessionControls({
  cycleId,
  session: initialSession,
  displayState,
  viewerId,
  canControl,
  children,
}: {
  cycleId: string
  session: SerializedSession | null
  displayState: SessionDisplayState
  viewerId: string
  canControl: boolean
  // Rendered inside the card, under the clock: the interview console puts the
  // candidate's identity here, the group console puts nothing.
  children?: React.ReactNode
}) {
  const router = useRouter()
  const { notify } = useRecruitmentLive(cycleId)
  const [session, setSession] = useState(initialSession)
  const [pending, startTransition] = useTransition()

  // The server is the source of truth, but an older refresh must not rewind a
  // newer local/server-confirmed view. Optimistic transitions use the next
  // version specifically so a refresh already in flight cannot flash the old
  // controls back onto the screen.
  useEffect(() => {
    setSession((current) => {
      if (!initialSession) return null
      if (
        !current ||
        current.id !== initialSession.id ||
        initialSession.version >= current.version
      ) return initialSession
      return current
    })
  }, [initialSession])

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
      let result
      try {
        result = await action()
      } catch {
        toast.error(t("recruitment.errors.generic"))
        return
      }
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

  function runOptimistic(
    kind: OptimisticSessionAction,
    action: () => Promise<
      { ok: true; idempotent: boolean; session: SerializedSession } | { ok: false; error: string; conflict?: SerializedSession }
    >,
    successMessage?: string,
  ) {
    if (!session) return
    const previous = session
    setSession(optimisticSessionTransition(previous, kind, viewerId))

    startTransition(async () => {
      try {
        const result = await action()
        if (result.ok) {
          setSession(result.session)
          if (result.idempotent) toast.info(t("recruitment.session.alreadyRunning"))
          else if (successMessage) toast.success(successMessage)
          notify("session")
          router.refresh()
          return
        }

        // A conflict is the authoritative newer state. Any other refusal rolls
        // the temporary view back to exactly what the operator had before.
        setSession(result.conflict ?? previous)
        toast.error(result.error)
        if (result.conflict) router.refresh()
      } catch {
        setSession(previous)
        toast.error(t("recruitment.errors.generic"))
      }
    })
  }

  const state = session?.state ?? "NOT_STARTED"
  const finished = state === "COMPLETED" || state === "ABORTED"
  const showingInitial =
    session?.state === initialSession?.state && session?.version === initialSession?.version
  const visibleDisplayState =
    displayState === "STALE" && showingInitial ? "STALE" : state

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SessionStateBadge state={visibleDisplayState} />
            {session && session.attempt > 1 && (
              <span className="text-xs text-muted-foreground">#{session.attempt}</span>
            )}
          </div>

          {children}

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
          {/* A finished session has no controls at all, which on its own reads as
              merely idle. Say it is over, and when. */}
          {finished && session?.endedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("recruitment.groups.finishedAt")}:{" "}
              <time dateTime={session.endedAt}>
                {session.endedAt.slice(0, 19).replace("T", " ")}
              </time>
            </p>
          )}
        </div>

        {canControl && session && (
          <div className="flex flex-wrap items-center gap-2">
            {state === "NOT_STARTED" && (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={pending}
                onClick={() =>
                  runOptimistic(
                    "start",
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
                  runOptimistic(
                    "pause",
                    () => pauseSession({ sessionId: session.id, expectedVersion: session.version }),
                  )
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
                  runOptimistic(
                    "resume",
                    () => resumeSession({ sessionId: session.id, expectedVersion: session.version }),
                  )
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
                  {/* Finishing now submits every complete draft on the panel
                      before it applies the verdict, so it is doing real work and
                      has to look like it. */}
                  {pending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Square className="size-3.5" />
                  )}
                  {pending
                    ? t("recruitment.session.finishing")
                    : t("recruitment.session.finish")}
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

          </div>
        )}
      </div>

      {visibleDisplayState === "STALE" && (
        <p className="mt-4 flex items-center gap-2 rounded-md bg-[var(--signal-soft)] px-3 py-2 text-sm text-[var(--ink-soft)]">
          <TriangleAlert className="size-4 shrink-0" />
          {t("recruitment.session.staleWarning")}
        </p>
      )}


    </Card>
  )
}
