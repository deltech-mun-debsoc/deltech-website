import { Users, IndianRupee, BedDouble, CheckCircle2, Building2 } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"
import { requireStaff } from "@/lib/authz"
import { t, type StringKey } from "@/content/strings"
import { PageHeader } from "../_components/page-header"
import { StatCard } from "./_components/stat-card"
import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

// recharts is ~100kB gzipped and this is the first screen every staff member
// hits. Split so it streams in after the numbers, which are the point of the
// page, rather than blocking them.
const StatusBarChart = dynamic(
  () => import("./_components/status-bar-chart").then((m) => m.StatusBarChart),
  { loading: () => <Skeleton className="h-64 w-full" /> },
)
const SourcePieChart = dynamic(
  () => import("./_components/source-pie-chart").then((m) => m.SourcePieChart),
  { loading: () => <Skeleton className="h-64 w-full" /> },
)
import { CommitteeFillTable } from "./_components/committee-fill-table"
import { SetupChecklist, type ChecklistItem } from "./_components/setup-checklist"
import { MaintainerWelcome } from "./_components/maintainer-welcome"
import { FailedEmailsCard } from "./_components/failed-emails-card"

export default async function AdminOverviewPage() {
  const session = await requireStaff()
  const isMaintainer = (session.user as { role?: string }).role === "MAINTAINER"

  const scope = await currentEventScope()

  const [
    total,
    byStatus,
    bySource,
    accommodationCount,
    revenueResult,
    committees,
    portfolioCounts,
    portfolioCount,
    feeCount,
    memberCount,
    publishedPostCount,
    failedEmailCount,
    recentFailedEmails,
    content,
  ] = await Promise.all([
    prisma.delegate.count({ where: scope }),
    prisma.delegate.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.delegate.groupBy({ by: ["source"], where: scope, _count: { _all: true } }),
    prisma.delegate.count({ where: { needsAccommodation: true, ...scope } }),
    prisma.payment.aggregate({
      where: { status: { in: ["PAID", "COMPED"] }, delegate: scope },
      _sum: { amountInr: true },
    }),
    prisma.committee.findMany({
      where: { isActive: true, ...scope },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        _count: { select: { portfolios: true } },
      },
    }),
    // One grouped count instead of one row per seat. This page pulled every
    // Portfolio in the conference purely to length-filter them in JS.
    prisma.portfolio.groupBy({
      by: ["committeeId", "status"],
      where: { committee: scope },
      _count: { _all: true },
    }),
    prisma.portfolio.count({ where: { committee: scope } }),
    prisma.fee.count(),
    prisma.member.count({ where: { isActive: true } }),
    prisma.post.count({ where: { status: "PUBLISHED" } }),
    prisma.emailLog.count({ where: { status: "FAILED" } }),
    prisma.emailLog.findMany({
      where: { status: "FAILED" },
      orderBy: { sentAt: "desc" },
      take: 8,
      select: { id: true, template: true, toEmail: true, error: true, sentAt: true, delegateId: true },
    }),
    getContent(),
  ])

  const eventActive = content.publicSections.activeEvent
  const paymentsActive = deriveEventState(content).paymentsRequired
  const checklist: ChecklistItem[] = [
    { done: true, label: `Operating mode: ${content.eventMode.replace("_", " ")}`, href: "/admin/config" },
    ...(eventActive ? [{
      done: !!content.conferenceDates && !!content.venue,
      label: "Set active event dates and venue",
      href: "/admin/config/conference",
    }] : []),
    { done: committees.length > 0, label: "Add committees", href: "/admin/config/committees" },
    { done: portfolioCount > 0, label: "Generate the portfolio matrix", href: "/admin/config/committees" },
    ...(paymentsActive ? [{ done: feeCount > 0, label: "Set registration fees", href: "/admin/config/money" }, {
      done: content.paymentProvider !== "static_link" || !!content.staticPaymentLink,
      label: "Configure the payment provider",
      href: "/admin/config/money",
    }] : []),
    { done: content.registrationOpen, label: "Open registration when ready", href: "/admin/config" },
    { done: memberCount > 0, label: "Publish the team roster", href: "/admin/team" },
    { done: publishedPostCount > 0, label: "Publish the first dispatch", href: "/admin/blog" },
  ]

  const revenue = revenueResult._sum.amountInr ?? 0
  const confirmedCount =
    byStatus.find((s) => s.status === "CONFIRMED")?._count._all ?? 0

  const statusData = byStatus.map((s) => ({
    name: t(("status." + s.status) as StringKey),
    value: s._count._all,
  }))

  const sourceData = bySource.map((s) => ({
    name: s.source,
    value: s._count._all,
  }))

  const takenByCommittee = new Map<string, number>()
  for (const g of portfolioCounts) {
    if (g.status !== "ALLOTTED" && g.status !== "BLOCKED") continue
    takenByCommittee.set(g.committeeId, (takenByCommittee.get(g.committeeId) ?? 0) + g._count._all)
  }

  const committeeData = committees.map((c) => ({
    name: c.name,
    total: c._count.portfolios,
    allotted: takenByCommittee.get(c.id) ?? 0,
  }))

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Society operations"
        title={t("admin.nav.overview")}
        description={`Live society and event operations · ${content.eventMode.replace("_", " ").toLowerCase()} mode.`}
      />

      {isMaintainer && <MaintainerWelcome />}
      {isMaintainer && <SetupChecklist items={checklist} />}

      {failedEmailCount > 0 && (
        <FailedEmailsCard
          count={failedEmailCount}
          logs={recentFailedEmails.map((l) => ({ ...l, sentAt: l.sentAt.toISOString() }))}
        />
      )}

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {paymentsActive ? <StatCard
          title={t("admin.overview.totalRegistrations")}
          value={total}
          icon={Users}
          description="all time"
        /> : <StatCard title="Operating mode" value={content.eventMode === "INTRA_MUN" ? "Free Intra" : "Society"} icon={Building2} description="payments disabled" />}
        <StatCard
          title="Confirmed"
          value={confirmedCount}
          icon={CheckCircle2}
          description="of total"
          trend={total > 0 ? `${Math.round((confirmedCount / total) * 100)}%` : "-"}
        />
        <StatCard
          title={t("admin.overview.revenueCollected")}
          value={`₹${revenue.toLocaleString("en-IN")}`}
          icon={IndianRupee}
          description="paid + comped"
        />
        <StatCard
          title={t("admin.overview.accommodationRequests")}
          value={accommodationCount}
          icon={BedDouble}
          description="delegates"
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="editorial-card p-5">
          <h2 className="eyebrow mb-5">{t("admin.overview.byStatus")}</h2>
          <StatusBarChart data={statusData} />
        </div>

        <div className="editorial-card p-5">
          <h2 className="eyebrow mb-5">{t("admin.overview.sourceBreakdown")}</h2>
          <SourcePieChart data={sourceData} />
        </div>
      </div>

      {/* Committee fill-rate table */}
      <div className="editorial-card p-5">
        <h2 className="eyebrow mb-5">{t("admin.overview.byCommittee")}, fill rate</h2>
        <CommitteeFillTable data={committeeData} />
      </div>
    </div>
  )
}
