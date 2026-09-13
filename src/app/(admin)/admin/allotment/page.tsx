import { prisma } from "@/lib/prisma"
import { currentEventScope, getActiveEvent } from "@/lib/event"
import { requireStaff } from "@/lib/authz"
import { AllotmentBoard } from "./_components/allotment-board"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"

export default async function AllotmentPage() {
  await requireStaff()

  const scope = await currentEventScope()

  const [committees, delegates, fees, content] = await Promise.all([
    prisma.committee.findMany({
      where: { isActive: true, ...scope },
      orderBy: { sortOrder: "asc" },
      include: {
        portfolios: {
          orderBy: { name: "asc" },
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
      where: { status: "REGISTERED", ...scope },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        institution: true,
        isDtu: true,
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={content.eventMode === "INTRA_MUN" ? "Free Intra MUN" : "Conference"}
        title="Allotment Board"
        description={paymentsRequired
          ? "Select a committee, then allot a portfolio. A payment request is created after allotment."
          : "Select a committee, then allot a portfolio. The delegate is confirmed immediately, no payment is created."}
      />
      <AllotmentBoard
        eventId={(await getActiveEvent())?.id ?? null}
        committees={serializedCommittees}
        delegates={serializedDelegates}
        fees={fees}
        paymentsRequired={paymentsRequired}
      />
    </div>
  )
}
