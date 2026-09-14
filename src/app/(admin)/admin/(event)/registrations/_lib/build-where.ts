import type { Prisma, AppStatus, Source } from "@/generated/prisma/client"

const VALID_STATUSES = new Set(["REGISTERED", "ALLOTTED", "PAYMENT_SENT", "CONFIRMED", "CANCELLED", "WAITLISTED"])
const VALID_SOURCES = new Set(["SELF", "CROSS_DEL", "SPONSORED", "INTERNAL", "MANUAL"])

export interface FilterParams {
  q?: string
  status?: string
  source?: string
  committeeId?: string
  isDtu?: string
  needsAccommodation?: string
  followUp?: string
  // "open": a question from the registration form nobody has answered yet.
  query?: string
}

// `now` is a parameter so scripts/check-contact-log.ts can pin "due" against a
// fixed clock rather than whenever the check happens to run.
export function buildDelegateWhere(params: FilterParams, now: Date = new Date()): Prisma.DelegateWhereInput {
  const where: Prisma.DelegateWhereInput = {}
  const andConditions: Prisma.DelegateWhereInput[] = []

  if (params.q) {
    andConditions.push({
      OR: [
        { fullName: { contains: params.q, mode: "insensitive" } },
        { email: { contains: params.q, mode: "insensitive" } },
        { institution: { contains: params.q, mode: "insensitive" } },
      ],
    })
  }

  if (params.committeeId) {
    andConditions.push({
      OR: [
        { pref1CommitteeId: params.committeeId },
        { pref2CommitteeId: params.committeeId },
      ],
    })
  }

  // The payment chase. Pushed into AND rather than assigned, so it narrows an
  // existing status filter instead of silently replacing it.
  //   due:   the latest follow-up date set for them has passed
  //   never: allotted, payment still outstanding, and nobody has logged a call
  if (params.followUp === "due") {
    andConditions.push({ nextFollowUpAt: { lte: now } })
  } else if (params.followUp === "never") {
    andConditions.push({ lastContactedAt: null, status: { in: ["ALLOTTED", "PAYMENT_SENT"] } })
  }

  if (params.query === "open") {
    andConditions.push({ query: { not: null }, NOT: { query: "" }, queryResolvedAt: null })
  }

  if (andConditions.length > 0) where.AND = andConditions

  if (params.status && VALID_STATUSES.has(params.status)) {
    where.status = params.status as AppStatus
  }

  if (params.source && VALID_SOURCES.has(params.source)) {
    where.source = params.source as Source
  }

  if (params.isDtu === "true") where.isDtu = true
  else if (params.isDtu === "false") where.isDtu = false

  if (params.needsAccommodation === "true") where.needsAccommodation = true
  else if (params.needsAccommodation === "false") where.needsAccommodation = false

  return where
}

export const VALID_SORT_FIELDS = ["createdAt", "fullName", "email", "institution", "status"] as const
export type SortField = (typeof VALID_SORT_FIELDS)[number]

export function parseSortField(raw?: string): SortField {
  if (raw && (VALID_SORT_FIELDS as readonly string[]).includes(raw)) return raw as SortField
  return "createdAt"
}
