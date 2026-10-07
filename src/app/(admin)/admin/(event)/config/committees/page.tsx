import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { currentEventScope } from "@/lib/event"
import { TabCommittees } from "../_components/tab-committees"
import { TabPortfolios } from "../_components/tab-portfolios"

export default async function CommitteesSettingsPage() {
  await requireStaff()
  // This event's committees only. Unscoped, a new event opened with every past
  // event's committees and seats in its matrix studio.
  const committees = await prisma.committee.findMany({
      where: await currentEventScope(),
      orderBy: { sortOrder: "asc" },
      include: { portfolios: { orderBy: { name: "asc" } } },
    })

  const serialized = committees.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    agenda: c.agenda,
    type: c.type,
    doubleDelegation: c.doubleDelegation,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    aliases: c.aliases,
    portfolioTagLabel: c.portfolioTagLabel,
    matrixBrief: c.matrixBrief,
    groupLink: c.groupLink,
    portfolios: c.portfolios.map((p) => ({
      id: p.id,
      committeeId: p.committeeId,
      name: p.name,
      status: p.status,
      tag: p.tag,
      priority: p.priority,
    })),
  }))

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Committees</h2>
        <TabCommittees committees={serialized} />
      </section>

      <section className="space-y-4 border-t border-border pt-8">
        <div>
          <h2 className="text-sm font-semibold">Matrix</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Generate or load a draft, correct it, then publish.</p>
        </div>
        <TabPortfolios committees={serialized} />
      </section>

    </div>
  )
}
