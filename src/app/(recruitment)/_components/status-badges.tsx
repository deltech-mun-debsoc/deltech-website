import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { t, type StringKey } from "@/content/strings"
import type { SessionDisplayState } from "@/lib/recruitment/session"

// Shared vocabulary for the recruitment surfaces, so a stage or a session state
// reads identically on the operator screens and on the admin monitor.

const STAGE_TONE: Record<string, string> = {
  INTAKE: "bg-muted text-muted-foreground",
  GD_PENDING: "bg-secondary text-secondary-foreground",
  GD_ACTIVE: "bg-[var(--teal-100)] text-[var(--teal-700)]",
  GD_COMPLETE: "bg-secondary text-secondary-foreground",
  // Visually distinct from "missing": a skipped GD is a decision, not a gap.
  GD_BYPASSED: "bg-accent text-accent-foreground",
  PI_PENDING: "bg-secondary text-secondary-foreground",
  PI_ACTIVE: "bg-[var(--teal-100)] text-[var(--teal-700)]",
  PI_COMPLETE: "bg-secondary text-secondary-foreground",
  DECISION: "bg-accent text-accent-foreground",
  CLOSED: "bg-muted text-muted-foreground",
}

export function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge className={cn("font-normal", STAGE_TONE[stage] ?? "bg-muted text-muted-foreground")}>
      {t(`recruitment.stage.${stage}` as StringKey)}
    </Badge>
  )
}

const RESULT_TONE: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  ON_HOLD: "bg-accent text-accent-foreground",
  SELECTED: "bg-[var(--teal-100)] text-[var(--teal-700)]",
  REJECTED: "bg-muted text-muted-foreground",
  WITHDRAWN: "bg-muted text-muted-foreground",
  DISQUALIFIED: "bg-[var(--signal-soft)] text-[var(--ink-soft)]",
}

export function ResultBadge({ result }: { result: string }) {
  if (result === "PENDING") return null
  return (
    <Badge className={cn("font-normal", RESULT_TONE[result] ?? "bg-muted text-muted-foreground")}>
      {t(`recruitment.result.${result}` as StringKey)}
    </Badge>
  )
}

const SESSION_TONE: Record<SessionDisplayState, string> = {
  NOT_STARTED: "bg-muted text-muted-foreground",
  ACTIVE: "bg-[var(--teal-100)] text-[var(--teal-700)]",
  PAUSED: "bg-accent text-accent-foreground",
  COMPLETED: "bg-secondary text-secondary-foreground",
  ABORTED: "bg-muted text-muted-foreground",
  // Stale is a warning, not a stored state: the session is still ACTIVE in the DB.
  STALE: "bg-[var(--signal-soft)] text-[var(--ink-soft)]",
}

export function SessionStateBadge({ state }: { state: SessionDisplayState }) {
  return (
    <Badge className={cn("font-normal", SESSION_TONE[state])}>
      {t(`recruitment.sessionState.${state}` as StringKey)}
      {state === "ACTIVE" && (
        <span
          aria-hidden
          className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current"
        />
      )}
    </Badge>
  )
}

export function AttendanceBadge({ attendance }: { attendance: string }) {
  // Present is the default and the common case: badging it would be noise on every
  // row. Only the exceptions are worth a badge.
  if (attendance === "PRESENT") return null
  return (
    <Badge
      className={cn(
        "font-normal",
        attendance === "ABSENT"
          ? "bg-[var(--signal-soft)] text-[var(--ink-soft)]"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      {t(`recruitment.attendance.${attendance}` as StringKey)}
    </Badge>
  )
}
