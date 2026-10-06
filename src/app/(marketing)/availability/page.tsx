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

function MatrixHero({ totalAvailable, exact }: { totalAvailable: number; exact: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-border/70 bg-ink py-20 text-paper sm:py-28">
      <div className="paper-grid absolute inset-0 opacity-[0.08]" aria-hidden />
      <div className="section-shell relative grid gap-10 lg:grid-cols-[1fr_0.42fr] lg:items-end">
        <div>
          <p className="eyebrow text-gold-300">{t("marketing.availabilityEyebrow")}</p>
          <h1 className="display-section mt-6 max-w-[11ch]">{t("marketing.availabilityTitle")}</h1>
          <p className="body-large mt-8 max-w-2xl text-paper/70">
            {exact ? t("marketing.availabilityBody") : t("marketing.availabilityCountsBody")}
          </p>
        </div>
        <div className="border-l border-paper/20 pl-7">
          <p className="font-mono text-[5rem] font-semibold leading-none tabular-nums text-gold-300 sm:text-[7rem]">
            {totalAvailable}
          </p>
          <p className="mt-4 text-base text-paper/70">{t("marketing.portfoliosStillOpen")}</p>
        </div>
      </div>
    </section>
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
        <MatrixHero totalAvailable={totalAvailable} exact={false} />
        <section className="py-16 sm:py-24">
          <div className="section-shell">
            {initial.length === 0 ? (
              <p className="border-y border-border py-16 text-lg text-muted-foreground">{t("empty.noCommittees")}</p>
            ) : (
              <AvailabilityBoard initial={initial} />
            )}
          </div>
        </section>
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
      <MatrixHero totalAvailable={totalAvailable} exact />
      <section className="py-16 sm:py-24">
        <div className="section-shell">
          {matrix.length === 0 ? (
            <p className="border-y border-border py-16 text-lg text-muted-foreground">{t("empty.noCommittees")}</p>
          ) : (
            <MatrixBoard paymentsRequired={deriveEventState(content).paymentsRequired} committees={matrix} />
          )}
        </div>
      </section>
    </div>
  )
}
