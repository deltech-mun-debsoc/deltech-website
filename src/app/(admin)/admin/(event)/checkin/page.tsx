import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"
import type { Prisma, AppStatus } from "@/generated/prisma/client"
import { t } from "@/content/strings"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { CheckinClient, type CheckinDelegate } from "./_components/checkin-client"

// Upper bound for the desk view. Search narrows; nobody scrolls past this.
const ROW_CAP = 300

const VALID_STATUSES = new Set(["REGISTERED", "ALLOTTED", "PAYMENT_SENT", "CONFIRMED", "CANCELLED", "WAITLISTED"])

export default async function CheckinPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await props.searchParams

  const get = (key: string) => {
    const v = params[key]
    return Array.isArray(v) ? v[0] : v
  }

  const q = get("q") ?? ""
  // Defaults to CONFIRMED, the desk only expects confirmed delegates to arrive,
  // but staff can broaden the filter for edge cases (walk-ins, corrections).
  const status = get("status") ?? "CONFIRMED"

  const scope = await currentEventScope()
  const where: Prisma.DelegateWhereInput = { ...scope }
  if (q) {
    where.AND = [
      {
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { institution: { contains: q, mode: "insensitive" } },
        ],
      },
    ]
  }
  if (status && VALID_STATUSES.has(status)) where.status = status as AppStatus

  const [delegatesRaw, checkedInCount, confirmedCount] = await Promise.all([
    prisma.delegate.findMany({
      where,
      orderBy: { fullName: "asc" },
      // The "All statuses" option sends status="", which fails the validity
      // test above, so `where.status` is never set and this query returned
      // every delegate. Combined with `include: { committee: true }` that
      // dragged each committee's agenda, ebMembers JSON and matrixBrief into
      // the client payload, for a mapper that reads only `committee.name`.
      take: ROW_CAP,
      select: {
        id: true,
        fullName: true,
        email: true,
        institution: true,
        status: true,
        isDtu: true,
        needsAccommodation: true,
        checkedInAt: true,
        checkedInBy: true,
        allotment: {
          select: {
            portfolio: {
              select: { name: true, committee: { select: { name: true } } },
            },
          },
        },
        payment: { select: { status: true } },
      },
    }),
    prisma.delegate.count({ where: { status: "CONFIRMED", checkedInAt: { not: null }, ...scope } }),
    prisma.delegate.count({ where: { status: "CONFIRMED", ...scope } }),
  ])

  const delegates: CheckinDelegate[] = delegatesRaw.map((d) => ({
    id: d.id,
    fullName: d.fullName,
    email: d.email,
    institution: d.institution,
    status: d.status,
    isDtu: d.isDtu,
    needsAccommodation: d.needsAccommodation,
    checkedInAt: d.checkedInAt?.toISOString() ?? null,
    checkedInBy: d.checkedInBy,
    committeeName: d.allotment?.portfolio.committee.name ?? null,
    portfolioName: d.allotment?.portfolio.name ?? null,
    paymentStatus: d.payment?.status ?? null,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.nav.checkin")}
        description={t("checkin.summary", { checkedIn: checkedInCount, confirmed: confirmedCount })}
      />
      <CheckinClient delegates={delegates} filters={{ q, status }} capped={delegates.length === ROW_CAP} showPayment={deriveEventState(await getContent()).paymentsRequired} />
    </div>
  )
}
