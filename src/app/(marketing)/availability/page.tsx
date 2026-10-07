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
    <header className="relative overflow-hidden border-b border-white/15 bg-ink py-16 text-paper sm:py-24">
      <div className="paper-grid absolute inset-0 opacity-[0.07]" aria-hidden />
      <div className="section-shell relative grid gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="text-sm font-medium text-gold-300">DelTech MUN</p>
          <h1 className="mt-4 font-display text-[clamp(3.25rem,7vw,6.5rem)] font-normal leading-none tracking-[-0.02em]">Committee availability</h1>
        </div>
        <p className="border-l border-paper/25 pl-5 text-lg text-paper/75">
          <span className="block font-mono text-4xl font-semibold text-paper tabular-nums">{totalAvailable}</span>
          {t("marketing.openPortfolios")}
        </p>
      </div>
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
      <div>
        <Heading totalAvailable={totalAvailable} />
        <div className="section-shell py-12 sm:py-20">
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
    <div>
      <Heading totalAvailable={totalAvailable} />
      <div className="section-shell py-12 sm:py-20">
        {matrix.length === 0 ? (
          <p className="text-lg text-muted-foreground">{t("empty.noCommittees")}</p>
        ) : (
          <MatrixBoard paymentsRequired={deriveEventState(content).paymentsRequired} committees={matrix} />
        )}
      </div>
    </div>
  )
}
