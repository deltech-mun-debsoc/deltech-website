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
  "payment-link": "Payment link",
  "staff-invite": "Staff invite",
}

// Who someone is, in one line: the roll number for an Intra MUN delegate (all
// DTU), the college otherwise.
export function delegateLine(d: { rollNumber: string | null; isDtu: boolean; institution: string }) {
  return d.rollNumber ?? (d.isDtu ? "DTU" : d.institution)
}
