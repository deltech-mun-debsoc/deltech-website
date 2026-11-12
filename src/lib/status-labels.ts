// Shared delegate + payment status display maps. Previously copy-pasted (and
// already drifting) between the delegate dashboard and the public status page.

export const STATUS_LABEL: Record<string, string> = {
  REGISTERED: "Registered",
  ALLOTTED: "Allotted, payment link coming soon",
  PAYMENT_SENT: "Payment pending",
  CONFIRMED: "Confirmed",
  // Shown, not stored: CONFIRMED with no seat yet (see delegateFacingStatus).
  ACCEPTED: "Accepted, seat to be assigned",
  CANCELLED: "Cancelled",
  WAITLISTED: "Waitlisted",
}

export const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  REGISTERED: "secondary",
  ALLOTTED: "outline",
  PAYMENT_SENT: "outline",
  CONFIRMED: "default",
  ACCEPTED: "outline",
  CANCELLED: "destructive",
  WAITLISTED: "secondary",
}

export const PAY_STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting payment",
  SENT: "Payment link sent",
  PAID: "Paid",
  OFFLINE: "Confirmed (UPI)",
  COMPED: "Comped",
  FAILED: "Payment failed",
}

// The status a delegate is shown. A draft seat (not emailed) is staff-only, so
// they still see what they had before it. Accepted with nothing to pay but no
// seat yet is not "Confirmed": that word promises a seat.
export function delegateFacingStatus(status: string, allotment: { emailSentAt: Date | null } | null): string {
  const sent = !!allotment?.emailSentAt
  if (status === "CONFIRMED" && !sent) return "ACCEPTED"
  if (allotment && !sent) return "REGISTERED"
  return status
}
