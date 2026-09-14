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

export const EMAIL_LABEL: Record<string, string> = {
  "registration-received": "Registration received",
  allotment: "Seat allotted",
  "co-delegate-notice": "Co-delegate added",
  "co-delegate-registered": "Co-delegate registered",
  "payment-confirmed": "Payment confirmed",
  "payment-reminder": "Payment reminder",
  "magic-link": "Sign-in link",
}
