import Link from "next/link"
import { Users, IndianRupee, CheckCircle2, Hourglass, ScanLine } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { currentEventScope, getActiveEvent } from "@/lib/event"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"
import { requireStaff } from "@/lib/authz"
import { t, type StringKey } from "@/content/strings"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { buttonVariants } from "@/components/ui/button"
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

  const event = await getActiveEvent()
  if (!event) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="No event is running. The society site is in its resting state." />
        <div className="editorial-card flex flex-col items-start gap-4 p-8">
          <p className="max-w-xl text-base text-muted-foreground">
            Start an event to take registrations, build a matrix and allot seats. It stays hidden until you publish it.
          </p>
          <Link href="/admin/config" className={buttonVariants()}>Start an event</Link>
        </div>
      </div>
    )
  }

  const scope = await currentEventScope()

  const [
    total,
    byStatus,
    bySource,
    checkedInCount,
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
    prisma.delegate.count({ where: { ...scope, status: "CONFIRMED", checkedInAt: { not: null } } }),
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
    // This event's delegates only: a failure from a closed event is not
    // something anyone running this one can act on.
    prisma.emailLog.count({ where: { status: "FAILED", delegate: { is: scope } } }),
    prisma.emailLog.findMany({
      where: { status: "FAILED", delegate: { is: scope } },
      orderBy: { sentAt: "desc" },
      take: 8,
      select: { id: true, template: true, toEmail: true, error: true, sentAt: true, delegateId: true },
    }),
    getContent(),
  ])

  const paymentsActive = deriveEventState(content).paymentsRequired
  const published = event.state !== "DRAFT"
  const checklist: ChecklistItem[] = [
    { done: published, label: `Publish ${event.name}`, href: "/admin/config" },
    { done: !!content.conferenceDates && !!content.venue, label: "Set the event's dates and venue", href: "/admin/config" },
    { done: committees.length > 0, label: "Add committees", href: "/admin/config/committees" },
    { done: portfolioCount > 0, label: "Build the portfolio matrix", href: "/admin/config/committees" },
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
  const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0
  const confirmedCount = count("CONFIRMED")
  const waitingCount = count("REGISTERED") + count("WAITLISTED")

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

  const details = [event.kind === "INTRA_MUN" ? "Intra MUN" : "Conference", content.conferenceDates, content.venue].filter(Boolean).join(" · ")

  return (
    <div className="space-y-8">
      <PageHeader title="Overview" description={published ? details : `${details} · not published yet`} />

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
        <StatCard title="Delegates" value={total} icon={Users} description="registered for this event" />
        <StatCard title="Waiting for a seat" value={waitingCount} icon={Hourglass} description="registered or waitlisted" />
        <StatCard
          title="Confirmed"
          value={confirmedCount}
          icon={CheckCircle2}
          description="of all delegates"
          trend={total > 0 ? `${Math.round((confirmedCount / total) * 100)}%` : "-"}
        />
        {paymentsActive ? (
          <StatCard
            title={t("admin.overview.revenueCollected")}
            value={`₹${revenue.toLocaleString("en-IN")}`}
            icon={IndianRupee}
            description="paid + comped"
          />
        ) : (
          <StatCard title="Checked in" value={checkedInCount} icon={ScanLine} description={`of ${confirmedCount} confirmed`} />
        )}
      </div>

      {/* Charts */}
      <div className={bySource.length > 1 ? "grid gap-6 lg:grid-cols-2" : "grid gap-6"}>
        <div className="editorial-card p-5">
          <h2 className="eyebrow mb-5">{t("admin.overview.byStatus")}</h2>
          <StatusBarChart data={statusData} />
        </div>

        {/* Only worth a chart when people arrived more than one way. */}
        {bySource.length > 1 && (
          <div className="editorial-card p-5">
            <h2 className="eyebrow mb-5">{t("admin.overview.sourceBreakdown")}</h2>
            <SourcePieChart data={sourceData} />
          </div>
        )}
      </div>

      {/* Committee fill-rate table */}
      <div className="editorial-card p-5">
        <h2 className="eyebrow mb-5">{t("admin.overview.byCommittee")}, fill rate</h2>
        <CommitteeFillTable data={committeeData} />
      </div>
    </div>
  )
}
