import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"
import { t } from "@/content/strings"
import {
  AvailabilityBoard,
  type CommitteeAvailability,
} from "./_components/availability-board"
import { MatrixBoard, type MatrixCommittee } from "./_components/matrix-board"

export const revalidate = 0

function Heading({ totalAvailable }: { totalAvailable: number }) {
  return (
    <header>
      <h1 className="text-3xl font-semibold">{t("marketing.availabilityTitle")}</h1>
      <p className="mt-2 text-lg text-muted-foreground">{t("marketing.openPortfoliosCount", { n: totalAvailable })}</p>
    </header>
  )
}

export default async function AvailabilityPage() {
  const content = await getContent()
  const scope = await currentEventScope()
  const committees = await prisma.committee.findMany({
    where: { isActive: true, ...scope },
    orderBy: { sortOrder: "asc" },
    include: {
      portfolios: {
        orderBy: { name: "asc" },
        include: { allotment: { select: { delegate: { select: { status: true } } } } },
      },
    },
  })

  const totalAvailable = committees.reduce(
    (sum, committee) =>
      sum + committee.portfolios.filter((portfolio) => portfolio.status === "AVAILABLE").length,
    0,
  )

  if (!content.matrixPublic) {
    const initial: CommitteeAvailability[] = committees.map((committee) => ({
      id: committee.id,
      name: committee.name,
      type: committee.type,
      doubleDelegation: committee.doubleDelegation,
      availableCount: committee.portfolios.filter((portfolio) => portfolio.status === "AVAILABLE").length,
    }))

    return (
      <div className="section-shell py-12 sm:py-16">
        <Heading totalAvailable={totalAvailable} />
        <div className="mt-10">
          {initial.length === 0 ? (
            <p className="text-lg text-muted-foreground">{t("empty.noCommittees")}</p>
          ) : (
            <AvailabilityBoard initial={initial} />
          )}
        </div>
      </div>
    )
  }

  const matrix: MatrixCommittee[] = committees.map((committee) => ({
    id: committee.id,
    name: committee.name,
    agenda: committee.agenda,
    type: committee.type,
    doubleDelegation: committee.doubleDelegation,
    portfolios: committee.portfolios.map((portfolio) => ({
      id: portfolio.id,
      name: portfolio.name,
      state:
        portfolio.status === "BLOCKED"
          ? ("blocked" as const)
          : portfolio.status === "ALLOTTED"
            ? portfolio.allotment?.delegate.status === "CONFIRMED"
              ? ("paid" as const)
              : ("allotted" as const)
            : ("available" as const),
    })),
  }))

  return (
    <div className="section-shell py-12 sm:py-16">
      <Heading totalAvailable={totalAvailable} />
      <div className="mt-10">
        {matrix.length === 0 ? (
          <p className="text-lg text-muted-foreground">{t("empty.noCommittees")}</p>
        ) : (
          <MatrixBoard paymentsRequired={deriveEventState(content).paymentsRequired} committees={matrix} />
        )}
      </div>
    </div>
  )
}
