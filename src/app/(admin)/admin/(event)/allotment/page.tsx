import { prisma } from "@/lib/prisma"
import { currentEventScope, getActiveEvent, getEventCapabilities } from "@/lib/event"
import { requireStaff } from "@/lib/authz"
import { AllotmentBoard } from "./_components/allotment-board"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"

export default async function AllotmentPage(props: { searchParams: Promise<{ delegate?: string }> }) {
  await requireStaff()
  const { delegate: focusDelegateId } = await props.searchParams

  const scope = await currentEventScope()

  const [committees, delegates, fees, content] = await Promise.all([
    prisma.committee.findMany({
      where: { isActive: true, ...scope },
      orderBy: { sortOrder: "asc" },
      include: {
        portfolios: {
          // Matrix rank first, as published, then name.
          orderBy: [{ priority: "asc" }, { name: "asc" }],
          include: {
            allotment: {
              include: {
                delegate: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true,
                    isDtu: true,
                    coDelegate: { select: { id: true, fullName: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.delegate.findMany({
      // CONFIRMED without a seat: accepted with nothing to pay, still to be placed.
      where: { status: { in: ["REGISTERED", "CONFIRMED"] }, allotment: null, ...scope },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        fullName: true,
        email: true,
        institution: true,
        isDtu: true,
        rollNumber: true,
        munExperience: true,
        pref1CommitteeId: true,
        pref1Portfolio: true,
        pref1PortfolioId: true,
        pref2CommitteeId: true,
        pref2Portfolio: true,
        pref2PortfolioId: true,
        pref3CommitteeId: true,
        pref3Portfolio: true,
        pref3PortfolioId: true,
        coDelegate: { select: { id: true, fullName: true } },
        createdAt: true,
      },
    }),
    prisma.fee.findMany(),
    getContent(),
  ])
  const paymentsRequired = deriveEventState(content).paymentsRequired

  const serializedDelegates = delegates.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
  }))

  const serializedCommittees = committees.map((c) => ({
    ...c,
    portfolios: c.portfolios.map((p) => ({
      ...p,
      holdExpiresAt: p.holdExpiresAt?.toISOString() ?? null,
      allotment: p.allotment
        ? {
            ...p.allotment,
            allottedAt: p.allotment.allottedAt.toISOString(),
            emailSentAt: p.allotment.emailSentAt?.toISOString() ?? null,
          }
        : null,
    })),
  }))

  const [event, caps] = await Promise.all([getActiveEvent(), getEventCapabilities()])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Allotment"
        description={paymentsRequired
          ? "Allotments are drafts until emailed. Emailing sends the seat and a payment link."
          : "Allotments are drafts until emailed. Emailing sends the seat and confirms the delegate."}
      />
      <AllotmentBoard
        focusDelegateId={focusDelegateId ?? null}
        eventId={event?.id ?? null}
        intra={caps.intra}
        committees={serializedCommittees}
        delegates={serializedDelegates}
        fees={fees}
        paymentsRequired={paymentsRequired}
      />
    </div>
  )
}
