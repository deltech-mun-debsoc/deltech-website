import { z } from "zod"
import type { Prisma } from "@/generated/prisma/client"

// Who a mail goes to. Filters are saved on the campaign as JSON, and anything
// read back from JSON is untrusted, so both shapes are parsed with zod before
// they reach a query.

const DELEGATE_STATUSES = ["REGISTERED", "ALLOTTED", "PAYMENT_SENT", "CONFIRMED", "CANCELLED", "WAITLISTED"] as const
const PAYMENT_STATUSES = ["PENDING", "SENT", "PAID", "FAILED", "COMPED", "OFFLINE"] as const

export const DelegateAudienceSchema = z.object({
  statuses: z.array(z.enum(DELEGATE_STATUSES)).default([]),
  committeeIds: z.array(z.string().min(1)).default([]),
  allotted: z.enum(["any", "yes", "no"]).default("any"),
  paymentStatuses: z.array(z.enum(PAYMENT_STATUSES)).default([]),
  isDtu: z.enum(["any", "yes", "no"]).default("any"),
  needsAccommodation: z.enum(["any", "yes", "no"]).default("any"),
  checkedIn: z.enum(["any", "yes", "no"]).default("any"),
})
export type DelegateAudience = z.infer<typeof DelegateAudienceSchema>

export const ContactAudienceSchema = z.object({
  tags: z.array(z.string().min(1)).default([]),
})
export type ContactAudience = z.infer<typeof ContactAudienceSchema>

export function parseDelegateAudience(raw: unknown): DelegateAudience {
  const parsed = DelegateAudienceSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : DelegateAudienceSchema.parse({})
}

export function parseContactAudience(raw: unknown): ContactAudience {
  const parsed = ContactAudienceSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : ContactAudienceSchema.parse({})
}

// The current event's delegates who match.
//
// Cancelled delegates are left out unless CANCELLED is explicitly chosen: someone
// removed from the event should not keep receiving its announcements because a
// filter was left broad.
export function buildDelegateAudienceWhere(
  audience: DelegateAudience,
  scope: { eventId: string },
): Prisma.DelegateWhereInput {
  const and: Prisma.DelegateWhereInput[] = [scope]

  if (audience.statuses.length > 0) and.push({ status: { in: [...audience.statuses] } })
  else and.push({ status: { not: "CANCELLED" } })

  if (audience.committeeIds.length > 0) {
    and.push({
      OR: [
        { allotment: { committeeId: { in: audience.committeeIds } } },
        { allotment: null, pref1CommitteeId: { in: audience.committeeIds } },
      ],
    })
  }
  if (audience.allotted === "yes") and.push({ allotment: { isNot: null } })
  if (audience.allotted === "no") and.push({ allotment: null })
  if (audience.paymentStatuses.length > 0) and.push({ payment: { status: { in: [...audience.paymentStatuses] } } })
  if (audience.isDtu !== "any") and.push({ isDtu: audience.isDtu === "yes" })
  if (audience.needsAccommodation !== "any") and.push({ needsAccommodation: audience.needsAccommodation === "yes" })
  if (audience.checkedIn === "yes") and.push({ checkedInAt: { not: null } })
  if (audience.checkedIn === "no") and.push({ checkedInAt: null })

  return { AND: and }
}

// How often one outreach contact may be mailed. Every few days is the cadence the
// secretariat asked for; this stops two campaigns scheduled close together from
// landing on the same person back to back, which is how a list gets reported as
// spam.
export const CONTACT_FREQUENCY_CAP_DAYS = 3

export function buildContactAudienceWhere(audience: ContactAudience, now: Date): Prisma.MailContactWhereInput {
  const cutoff = new Date(now.getTime() - CONTACT_FREQUENCY_CAP_DAYS * 24 * 60 * 60 * 1000)
  const and: Prisma.MailContactWhereInput[] = [
    { unsubscribedAt: null },
    { bouncedAt: null },
    { OR: [{ lastMailedAt: null }, { lastMailedAt: { lt: cutoff } }] },
  ]
  if (audience.tags.length > 0) and.push({ tags: { hasSome: audience.tags } })
  return { AND: and }
}
