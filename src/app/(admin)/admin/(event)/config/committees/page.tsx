import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { requireStaff } from "@/lib/authz"
import { TabCommittees } from "../_components/tab-committees"
import { TabPortfolios } from "../_components/tab-portfolios"
import { MatrixVisibilityCard } from "../_components/matrix-visibility-card"
import { ResyncMatrixCard } from "../_components/resync-matrix-card"

export default async function CommitteesSettingsPage() {
  await requireStaff()
  const [content, committees] = await Promise.all([
    getContent(),
    prisma.committee.findMany({
      orderBy: { sortOrder: "asc" },
      include: { portfolios: { orderBy: { name: "asc" } } },
    }),
  ])

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
    <div className="space-y-12">
      <section className="border-t-4 border-foreground pt-6">
        <p className="eyebrow">01 / Structure</p>
        <h2 className="mt-3 font-heading text-3xl">Committees</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The bodies of the conference, with import aliases for partner sheets.
        </p>
        <div className="rule my-6" />
        <TabCommittees committees={serialized} />
      </section>

      <section className="border-t-4 border-foreground pt-6">
        <p className="eyebrow">02 / Matrix studio</p>
        <h2 className="mt-3 font-heading text-3xl">Build the room</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Give the generator the scenario, inspect its reasoning, correct the draft, then publish it.
        </p>
        <div className="rule my-5" />
        <TabPortfolios committees={serialized} />
      </section>

      <MatrixVisibilityCard matrixPublic={content.matrixPublic} />
      <ResyncMatrixCard />
    </div>
  )
}
