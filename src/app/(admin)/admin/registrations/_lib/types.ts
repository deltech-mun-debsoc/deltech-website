import type { Prisma } from "@/generated/prisma/client"
import { publicPaymentLink } from "@/lib/payments/public-link"

// emailLogs deliberately absent. It had no take and no select, so every page
// of 25 delegates dragged in every email ever sent to those 25 (including the
// `error` text column) for a table that renders none of it. Only the drawer
// uses them, one delegate at a time, so it fetches them on open instead.
export const delegateInclude = {
  coDelegate: true,
  allotment: { include: { portfolio: { select: { name: true } } } },
  payment: true,
} as const

export type DelegateRaw = Prisma.DelegateGetPayload<{ include: typeof delegateInclude }>

/** Date fields serialized to ISO strings for safe client-component props. */
export interface SerializedDelegate {
  id: string
  fullName: string
  email: string
  whatsapp: string
  altPhone: string | null
  institution: string
  isDtu: boolean
  rollNumber: string | null
  query: string | null
  munExperience: string | null
  source: string
  sourceNote: string | null
  pref1CommitteeId: string | null
  pref1Portfolio: string | null
  pref2CommitteeId: string | null
  pref2Portfolio: string | null
  needsAccommodation: boolean
  outsideNcr: boolean
  reference: string | null
  status: string
  createdAt: string
  coDelegate: {
    id: string
    delegateId: string
    fullName: string
    email: string
    phone: string
    institution: string | null
    munExperience: string | null
  } | null
  allotment: {
    id: string
    delegateId: string
    committeeId: string
    portfolioId: string
    allottedAt: string
    allottedBy: string
    emailSentAt: string | null
    portfolio: { name: string }
  } | null
  payment: {
    id: string
    delegateId: string
    provider: string
    amountInr: number
    status: string
    razorpayOrderId: string | null
    razorpayPaymentId: string | null
    paymentLink: string | null
    method: string | null
    confirmedAt: string | null
    createdAt: string
  } | null
}

/** Fetched on demand when the drawer opens, not with the table. */
export interface EmailLogEntry {
  id: string
  template: string
  status: string
  error: string | null
  sentAt: string
}

export function serializeDelegate(d: DelegateRaw): SerializedDelegate {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    allotment: d.allotment
      ? {
          ...d.allotment,
          allottedAt: d.allotment.allottedAt.toISOString(),
          emailSentAt: d.allotment.emailSentAt?.toISOString() ?? null,
        }
      : null,
    payment: d.payment
      ? {
          ...d.payment,
          paymentLink: d.payment.paymentLink
            ? publicPaymentLink(d.payment.paymentLink, d.publicToken)
            : null,
          createdAt: d.payment.createdAt.toISOString(),
          confirmedAt: d.payment.confirmedAt?.toISOString() ?? null,
        }
      : null,
  }
}
