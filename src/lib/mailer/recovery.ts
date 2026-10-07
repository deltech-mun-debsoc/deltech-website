import { formatTime } from "@/lib/datetime"

// What a campaign's outcome means to staff, and what can safely be done about
// each recipient it did not reach. Pure, so scripts/check-mailer.ts pins it.

export type RecipientCounts = Partial<Record<"PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED" | "UNCERTAIN", number>>

// "Sent" used to be shown for a campaign whose recipients partly failed.
export function campaignStateLabel(state: string, counts: RecipientCounts): string {
  const failed = counts.FAILED ?? 0
  const uncertain = counts.UNCERTAIN ?? 0
  if (state === "SENT") {
    const parts = [
      failed > 0 && `${failed} ${failed === 1 ? "failure" : "failures"}`,
      uncertain > 0 && `${uncertain} to check`,
    ].filter(Boolean)
    return parts.length ? `Completed with ${parts.join(" and ")}` : "Completed"
  }
  if (state === "CANCELLED") return (counts.SENT ?? 0) > 0 ? "Stopped part way" : "Cancelled"
  return { DRAFT: "Draft", SCHEDULED: "Scheduled", SENDING: "Sending" }[state] ?? state.toLowerCase()
}

export type RecoveryAction =
  // A transient failure, or a bounce whose address has since been fixed.
  | { kind: "retry"; cause: string; newEmail?: string }
  // Interrupted after it was handed over: it may have arrived. A person checks first.
  | { kind: "check"; cause: string }
  // The address bounced or flagged us as spam and has not changed.
  | { kind: "fix-address"; cause: string }
  | { kind: "none"; cause: string }

export function recoveryFor(
  r: { status: string; email: string; error: string | null },
  // The delegate's address now, when the recipient is a delegate.
  currentEmail?: string | null,
): RecoveryAction {
  const cause = (r.error ?? "").trim() || "No reason was recorded."
  const moved = !!currentEmail && currentEmail.trim().toLowerCase() !== r.email.trim().toLowerCase()
  if (r.status === "UNCERTAIN") return { kind: "check", cause }
  if (r.status !== "FAILED") return { kind: "none", cause }
  if (/^(Bounced|Marked as spam):/.test(cause)) {
    return moved ? { kind: "retry", cause, newEmail: currentEmail!.trim().toLowerCase() } : { kind: "fix-address", cause }
  }
  return moved ? { kind: "retry", cause, newEmail: currentEmail!.trim().toLowerCase() } : { kind: "retry", cause }
}

// Whether a big campaign is waiting on the rolling daily limit, and roughly
// when it can go on: the oldest send in the window ages out first.
export function dailyLimitNote(input: { sentLast24h: number; cap: number; pending: number; oldestInWindow: Date | null }): string | null {
  if (input.pending === 0) return null
  const left = Math.max(0, input.cap - input.sentLast24h)
  if (left > 0) return null
  const resumes = input.oldestInWindow ? new Date(input.oldestInWindow.getTime() + 24 * 60 * 60 * 1000) : null
  return `${input.pending} waiting for the daily sending limit (${input.cap} a day)${
    resumes ? `; more can go from about ${formatTime(resumes)}` : ""
  }.`
}
