import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { buildDelegateWhere, parseSortField } from "./_lib/build-where"
import { delegateInclude, serializeDelegate } from "./_lib/types"
import { RegistrationsClient } from "./_components/registrations-client"
import { DelegateTabs } from "./_components/delegate-tabs"
import type { Prisma } from "@/generated/prisma/client"
import { t } from "@/content/strings"
import { PageHeader } from "@/app/(admin)/_components/page-header"

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100

export default async function RegistrationsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await props.searchParams

  const get = (key: string) => {
    const v = params[key]
    return Array.isArray(v) ? v[0] : v
  }

  const q = get("q") ?? ""
  const committeeId = get("committeeId") ?? ""
  const status = get("status") ?? ""
  const source = get("source") ?? ""
  const isDtu = get("isDtu") ?? ""
  const needsAccommodation = get("needsAccommodation") ?? ""
  const followUp = get("followUp") ?? ""
  const query = get("query") ?? ""
  const page = Math.max(1, parseInt(get("page") ?? "1", 10) || 1)
  const perPage = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(get("perPage") ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT))
  const sortBy = parseSortField(get("sortBy"))
  const sortDir = (get("sortDir") === "asc" ? "asc" : "desc") as "asc" | "desc"

  const scope = await currentEventScope()
  // Scoped to the current event. This used to compute the scope and apply it only
  // to the committee dropdown, so the delegate list and its count spanned every
  // event: harmless while one existed, wrong the moment a second did.
  const where: Prisma.DelegateWhereInput = {
    ...buildDelegateWhere({ q: q || undefined, committeeId: committeeId || undefined, status: status || undefined, source: source || undefined, isDtu: isDtu || undefined, needsAccommodation: needsAccommodation || undefined, followUp: followUp || undefined, query: query || undefined }),
    ...scope,
  }

  const orderBy: Prisma.DelegateOrderByWithRelationInput = { [sortBy]: sortDir }

  const [delegatesRaw, total, committees] = await Promise.all([
    prisma.delegate.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
      include: delegateInclude,
    }),
    prisma.delegate.count({ where }),
    prisma.committee.findMany({
      where: { isActive: true, ...scope },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, slug: true },
    }),
  ])

  const delegates = delegatesRaw.map(serializeDelegate)

  const filters = { q, committeeId, status, source, isDtu, needsAccommodation, followUp, query, page, perPage, sortBy, sortDir }

  return (
    <div className="space-y-6">
      <DelegateTabs />
      <PageHeader
        eyebrow="Delegates"
        title={t("admin.nav.registrations")}
        description={`${total} ${total === 1 ? "delegate" : "delegates"} match · tick rows to mail them`}
      />
      <RegistrationsClient
        delegates={delegates}
        committees={committees}
        total={total}
        filters={filters}
      />
    </div>
  )
}
