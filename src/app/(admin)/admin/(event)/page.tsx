import Link from "next/link"
import { ArrowRight, CheckCircle2, ChevronDown } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { currentEventScope, getActiveEvent } from "@/lib/event"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"
import { requireStaff } from "@/lib/authz"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import { STATUS_META } from "./registrations/_lib/status"
import { buildDelegateWhere } from "./registrations/_lib/build-where"

// recharts is ~100kB gzipped and this is the first screen every staff member
// hits, so the one chart left here streams in after everything else.
const SourcePieChart = dynamic(
  () => import("./_components/source-pie-chart").then((m) => m.SourcePieChart),
  { loading: () => <Skeleton className="h-64 w-full" /> },
)
import { SetupChecklist, type ChecklistItem } from "./_components/setup-checklist"
import { MaintainerWelcome } from "./_components/maintainer-welcome"
import { FailedEmailsCard } from "./_components/failed-emails-card"

const SOURCE_LABEL: Record<string, string> = {
  SELF: "Website form",
  CROSS_DEL: "Cross delegation",
  SPONSORED: "Sponsored",
  INTERNAL: "Internal",
  MANUAL: "Added by staff",
}

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
            Start a new event, or reopen a past one, to take registrations and allot seats.
          </p>
          <Link href="/admin/config" className={buttonVariants()}>Go to Setup</Link>
        </div>
      </div>
    )
  }

  const scope = await currentEventScope()

  const [
    byStatus,
    bySource,
    checkedInCount,
    revenueResult,
    committees,
    portfolioCounts,
    feeCount,
    memberCount,
    publishedPostCount,
    failedEmailCount,
    recentFailedEmails,
    openQuestions,
    followUpsDue,
    content,
  ] = await Promise.all([
    prisma.delegate.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.delegate.groupBy({ by: ["source"], where: scope, _count: { _all: true } }),
    prisma.delegate.count({ where: { ...scope, status: "CONFIRMED", checkedInAt: { not: null } } }),
    prisma.payment.aggregate({
      where: { status: { in: ["PAID", "OFFLINE"] }, delegate: scope },
      _sum: { amountInr: true },
    }),
    prisma.committee.findMany({
      where: { isActive: true, ...scope },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    // One grouped count instead of one row per seat.
    prisma.portfolio.groupBy({
      by: ["committeeId", "status"],
      where: { committee: scope },
      _count: { _all: true },
    }),
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
    prisma.delegate.count({ where: { ...scope, ...buildDelegateWhere({ query: "open" }) } }),
    prisma.delegate.count({ where: { ...scope, ...buildDelegateWhere({ followUp: "due" }) } }),
    getContent(),
  ])

  const paymentsActive = deriveEventState(content).paymentsRequired
  const published = event.state !== "DRAFT"
  const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0
  const waiting = count("REGISTERED")
  const unpaid = count("ALLOTTED") + count("PAYMENT_SENT")
  const confirmed = count("CONFIRMED")
  const seatCount = portfolioCounts.reduce((n, g) => n + g._count._all, 0)

  const checklist: ChecklistItem[] = [
    { done: published, label: `Publish ${event.name}`, href: "/admin/config" },
    { done: !!content.conferenceDates && !!content.venue, label: "Set the event's dates and venue", href: "/admin/config" },
    { done: committees.length > 0, label: "Add committees", href: "/admin/config/committees" },
    { done: seatCount > 0, label: "Build the portfolio matrix", href: "/admin/config/committees" },
    ...(paymentsActive ? [{ done: feeCount > 0, label: "Set registration fees", href: "/admin/config/money" }, {
      done: content.paymentProvider !== "static_link" || !!content.staticPaymentLink,
      label: "Configure the payment provider",
      href: "/admin/config/money",
    }] : []),
    { done: content.registrationOpen, label: "Open registration when ready", href: "/admin/config" },
    { done: memberCount > 0, label: "Publish the team roster", href: "/admin/team" },
    { done: publishedPostCount > 0, label: "Publish the first dispatch", href: "/admin/blog" },
  ]

  // The journey left to right. Removed delegates sit at the end, greyed, so the
  // bar still adds up to everyone who registered.
  const stages = [
    { key: "REGISTERED", count: waiting, href: "/admin/registrations?status=REGISTERED" },
    { key: "WAITLISTED", count: count("WAITLISTED"), href: "/admin/registrations?status=WAITLISTED" },
    { key: "PAYMENT_SENT", count: unpaid, href: "/admin/registrations?status=PAYMENT_SENT", label: "Seated, unpaid" },
    { key: "CONFIRMED", count: confirmed, href: "/admin/registrations?status=CONFIRMED" },
    { key: "CANCELLED", count: count("CANCELLED"), href: "/admin/registrations?status=CANCELLED" },
  ].filter((s) => s.count > 0)
  const everyone = stages.reduce((n, s) => n + s.count, 0)

  const todo = [
    waiting > 0 && { label: `${waiting} waiting for a seat`, action: "Give seats", href: "/admin/allotment", tone: "bg-amber-500" },
    openQuestions > 0 && { label: `${openQuestions} unanswered ${openQuestions === 1 ? "question" : "questions"}`, action: "Answer", href: "/admin/registrations?query=open", tone: "bg-amber-500" },
    paymentsActive && followUpsDue > 0 && { label: `${followUpsDue} follow-ups due`, action: "Call them", href: "/admin/registrations?followUp=due", tone: "bg-sky-500" },
    paymentsActive && unpaid > 0 && { label: `${unpaid} seated but not paid`, action: "Chase", href: "/admin/registrations?status=PAYMENT_SENT", tone: "bg-sky-500" },
  ].filter(Boolean) as { label: string; action: string; href: string; tone: string }[]

  const committeeFill = committees.map((c) => {
    const rows = portfolioCounts.filter((g) => g.committeeId === c.id)
    const total = rows.reduce((n, g) => n + g._count._all, 0)
    const taken = rows.filter((g) => g.status === "ALLOTTED").reduce((n, g) => n + g._count._all, 0)
    return { ...c, total, taken }
  })

  const details = [event.kind === "INTRA_MUN" ? "Intra MUN" : "Conference", content.conferenceDates, content.venue].filter(Boolean).join(" · ")
  const revenue = revenueResult._sum.amountInr ?? 0

  return (
    <div className="space-y-10">
      <PageHeader title="Overview" description={published ? details : `${details} · not published yet`} />

      {isMaintainer && <MaintainerWelcome />}
      {isMaintainer && <SetupChecklist items={checklist} />}

      {failedEmailCount > 0 && (
        <FailedEmailsCard
          count={failedEmailCount}
          logs={recentFailedEmails.map((l) => ({ ...l, sentAt: l.sentAt.toISOString() }))}
        />
      )}

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="editorial-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-heading text-xl">Delegates</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-heading text-3xl tabular-nums text-foreground">{everyone}</span> registered
              {paymentsActive && revenue > 0 && ` · ₹${revenue.toLocaleString("en-IN")} collected`}
            </p>
          </div>
          {everyone === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">Nobody has registered yet.</p>
          ) : (
            <>
              <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-muted">
                {stages.map((s) => (
                  <div key={s.key} className={cn(STATUS_META[s.key].dot, "h-full")} style={{ width: `${(s.count / everyone) * 100}%` }} />
                ))}
              </div>
              <ul className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {stages.map((s) => (
                  <li key={s.key}>
                    <Link href={s.href} className="group flex items-center gap-2.5 text-sm">
                      <span className={cn("size-2.5 rounded-full", STATUS_META[s.key].dot)} />
                      <span className="text-muted-foreground group-hover:text-foreground">{s.label ?? STATUS_META[s.key].label}</span>
                      <span className="ml-auto font-medium tabular-nums">{s.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {confirmed > 0 && (
                <p className="mt-5 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                  <Link href="/admin/checkin" className="hover:text-foreground">
                    <span className="font-medium text-foreground">{`${checkedInCount} of ${confirmed}`}</span> confirmed delegates checked in
                  </Link>
                </p>
              )}
            </>
          )}
        </div>

        <div className="editorial-card p-6">
          <h2 className="font-heading text-xl">Needs you</h2>
          {todo.length === 0 ? (
            <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600" /> Nothing waiting on you right now.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border/60">
              {todo.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="group flex items-center gap-3 py-3.5 text-sm">
                    <span className={cn("size-2 rounded-full", item.tone)} />
                    <span className="flex-1">{item.label}</span>
                    <span className="flex items-center gap-1 font-medium text-primary">
                      {item.action} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-xl">Committees</h2>
          <Link href="/admin/allotment" className="text-sm text-muted-foreground hover:text-foreground">Open allotment</Link>
        </div>
        {committeeFill.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No committees yet. <Link href="/admin/config/committees" className="underline underline-offset-2">Add them in Setup</Link>.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {committeeFill.map((c) => {
              const pct = c.total ? Math.round((c.taken / c.total) * 100) : 0
              return (
                <div key={c.id} className="editorial-card p-5">
                  <p className="truncate font-medium">{c.name}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    <span className="font-medium tabular-nums text-foreground">{c.taken}</span>
                    {` of ${c.total} seats filled`}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {bySource.length > 1 && (
        <details className="group editorial-card p-6">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
            Where delegates came from
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-5">
            <SourcePieChart data={bySource.map((s) => ({ name: SOURCE_LABEL[s.source] ?? s.source, value: s._count._all }))} />
          </div>
        </details>
      )}
    </div>
  )
}
