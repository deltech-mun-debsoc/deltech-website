// One colour per stage, so a list reads by colour before anyone reads a word.
export const STATUS_META: Record<string, { label: string; dot: string; pill: string }> = {
  REGISTERED: { label: "Waiting", dot: "bg-amber-500", pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  WAITLISTED: { label: "Waitlisted", dot: "bg-stone-400", pill: "bg-stone-500/10 text-stone-600 dark:text-stone-300" },
  ALLOTTED: { label: "Seated, unpaid", dot: "bg-sky-500", pill: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  PAYMENT_SENT: { label: "Pay link sent", dot: "bg-sky-500", pill: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  CONFIRMED: { label: "Confirmed", dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  CANCELLED: { label: "Removed", dot: "bg-red-500", pill: "bg-red-500/10 text-red-700 dark:text-red-300" },
}

export function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, dot: "bg-muted-foreground", pill: "bg-muted text-muted-foreground" }
}

// A pseudo-status for filters: accepted (nothing to pay) but holding no seat.
// Cross delegations land here when none of their choices was free.
export const NEEDS_SEAT = "NEEDS_SEAT"
STATUS_META[NEEDS_SEAT] = { label: "Accepted, needs a seat", dot: "bg-amber-500", pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300" }

// The stage a person is actually at. Status alone said "Confirmed" for a
// cross delegate whose preferred seats were all taken: confirmed, and seated
// nowhere. A seat that exists but has not been emailed is a draft, which the
// delegate has not heard about either.
export function stageOf(d: { status: string; allotment: { emailSentAt: string | Date | null } | null }) {
  if (d.status === "CONFIRMED" && !d.allotment) return statusMeta(NEEDS_SEAT)
  if (d.status === "CONFIRMED" && !d.allotment?.emailSentAt) {
    return { ...statusMeta("CONFIRMED"), label: "Accepted, seat not sent" }
  }
  if (d.status === "REGISTERED" && d.allotment && !d.allotment.emailSentAt) {
    return { ...statusMeta("REGISTERED"), label: "Seat drafted" }
  }
  return statusMeta(d.status)
}

export const EMAIL_LABEL: Record<string, string> = {
  "registration-received": "Registration received",
  allotment: "Seat allotted",
  "co-delegate-notice": "Co-delegate allotment",
  "co-delegate-registered": "Co-delegate registered",
  "payment-confirmed": "Payment confirmed",
  "payment-reminder": "Payment reminder",
  "magic-link": "Sign-in link",
  "ses-event": "Delivery report",
  "staff-invite": "Staff invite",
}

// Who someone is, in one line: the roll number for an Intra MUN delegate (all
// DTU), the college otherwise.
export function delegateLine(d: { rollNumber: string | null; isDtu: boolean; institution: string }) {
  return d.rollNumber ?? (d.isDtu ? "DTU" : d.institution)
}

// What an email log row's status means, said plainly. SENT is only "the email
// service accepted it"; DELIVERED is the receiving server taking it.
export const EMAIL_STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" }> = {
  DELIVERED: { label: "delivered", tone: "ok" },
  SENT: { label: "accepted by the email service", tone: "ok" },
  DEFERRED: { label: "delayed by their mail server", tone: "wait" },
  BOUNCED: { label: "bounced", tone: "bad" },
  COMPLAINED: { label: "marked as spam", tone: "bad" },
  FAILED: { label: "did not send", tone: "bad" },
}

export function emailLabel(template: string): string {
  if (template.startsWith("mailer:")) return "Mail to delegates"
  return EMAIL_LABEL[template] ?? template
}

// The Emails heading and whether it needs attention. Counts each outcome
// separately ("4 sent · 1 bounced") instead of calling every row "sent", and
// alerts only when the LATEST attempt of a kind of email went wrong: a failure
// that was later sent successfully is history, not a problem.
export function emailSummary(logs: { template: string; status: string; sentAt: string }[]) {
  const counts: Record<string, number> = {}
  for (const l of logs) {
    const key = l.status === "DELIVERED" ? "SENT" : l.status
    counts[key] = (counts[key] ?? 0) + 1
  }
  const order: [string, string][] = [
    ["SENT", "sent"],
    ["DEFERRED", "delayed"],
    ["FAILED", "failed"],
    ["BOUNCED", "bounced"],
    ["COMPLAINED", "marked as spam"],
  ]
  const hint = order.filter(([k]) => counts[k]).map(([k, word]) => `${counts[k]} ${word}`).join(" · ")
  const latest = new Map<string, string>()
  for (const l of [...logs].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    if (l.template === "ses-event") continue
    latest.set(l.template, l.status)
  }
  const alert = [...latest.values()].some((s) => EMAIL_STATUS[s]?.tone === "bad")
  return { hint: hint || "none yet", alert }
}

// Whether email to this address is pointless until it changes: its latest
// outcome was a bounce or a spam complaint.
export function addressBlockedIn(logs: { toEmail: string; status: string; sentAt: string }[], email: string): "BOUNCED" | "COMPLAINED" | null {
  const mine = logs
    .filter((l) => l.toEmail.trim().toLowerCase() === email.trim().toLowerCase() && l.status !== "DEFERRED")
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
  const s = mine[0]?.status
  return s === "BOUNCED" || s === "COMPLAINED" ? s : null
}
