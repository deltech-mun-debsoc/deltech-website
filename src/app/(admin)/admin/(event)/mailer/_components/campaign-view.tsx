import { notFound, redirect } from "next/navigation"
import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { currentEventScope, getEventCapabilities } from "@/lib/event"
import { formatDate } from "@/lib/datetime"
import { dailyCap, prMailEnabled } from "@/lib/mailer/queue"
import { campaignStateLabel, dailyLimitNote, recoveryFor } from "@/lib/mailer/recovery"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { Badge } from "@/components/ui/badge"
import { Composer } from "./composer"
import { CampaignActions } from "./campaign-actions"
import { FailureReview } from "./failure-review"

type Audience = "DELEGATES" | "CONTACTS"
const baseFor = (audience: Audience) => (audience === "CONTACTS" ? "/admin/outreach" : "/admin/mailer")

// One campaign, opened from event Mail or from PR outreach. A link to the wrong
// area is redirected to the right one rather than shown out of place.
export async function CampaignView({ id, audience }: { id: string; audience: Audience }) {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const campaign = await prisma.mailCampaign.findUnique({ where: { id } })
  if (!campaign) notFound()
  if (campaign.audience !== audience) redirect(`${baseFor(campaign.audience)}/${id}`)

  const area = audience === "DELEGATES" ? "Mail" : "PR outreach"

  if (campaign.state === "DRAFT") {
    const [committees, tagRows, prOn] = await Promise.all([
      audience === "DELEGATES"
        ? prisma.committee.findMany({ where: { isActive: true, ...(await currentEventScope()) }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } })
        : Promise.resolve([]),
      audience === "CONTACTS" ? prisma.mailContact.findMany({ where: { unsubscribedAt: null }, select: { tags: true } }) : Promise.resolve([]),
      prMailEnabled(),
    ])
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={`${area} · draft`} title={campaign.subject || "Untitled mail"} description={`Drafted by ${campaign.createdBy}`} />
        <CampaignActions id={campaign.id} state={campaign.state} isAdmin={isAdmin} base={baseFor(audience)} />
        <Composer
          audience={audience}
          campaign={{ ...campaign, filters: campaign.filters }}
          committees={committees}
          tags={[...new Set(tagRows.flatMap((r) => r.tags))].sort()}
          prOn={prOn}
          isAdmin={isAdmin}
          caps={audience === "DELEGATES" ? await getEventCapabilities() : undefined}
        />
      </div>
    )
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [grouped, recipients, failures, sentLast24h, oldest] = await Promise.all([
    prisma.mailRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
    prisma.mailRecipient.findMany({
      where: { campaignId: id },
      orderBy: [{ status: "asc" }, { email: "asc" }],
      take: 300,
      select: { id: true, email: true, name: true, status: true, error: true, sentAt: true },
    }),
    prisma.mailRecipient.findMany({
      where: { campaignId: id, status: { in: ["FAILED", "UNCERTAIN"] } },
      orderBy: { email: "asc" },
      take: 500,
      select: { id: true, email: true, name: true, status: true, error: true, delegateId: true },
    }),
    prisma.mailRecipient.count({ where: { status: "SENT", sentAt: { gte: since } } }),
    prisma.mailRecipient.findFirst({ where: { status: "SENT", sentAt: { gte: since } }, orderBy: { sentAt: "asc" }, select: { sentAt: true } }),
  ])
  const n = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]))
  const label = campaignStateLabel(campaign.state, counts)
  const capNote =
    campaign.state === "SENDING"
      ? dailyLimitNote({ sentLast24h, cap: dailyCap(), pending: n("PENDING"), oldestInWindow: oldest?.sentAt ?? null })
      : null
  const current = new Map(
    (
      await prisma.delegate.findMany({
        where: { id: { in: failures.map((f) => f.delegateId).filter((x): x is string => !!x) } },
        select: { id: true, email: true },
      })
    ).map((d) => [d.id, d.email]),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={area}
        title={campaign.subject}
        description={`${label} · by ${campaign.createdBy}${campaign.scheduledAt ? ` · for ${formatDate(campaign.scheduledAt)}` : ""}`}
      />
      <CampaignActions
        id={campaign.id}
        state={campaign.state}
        isAdmin={isAdmin}
        base={baseFor(audience)}
        canSendBatch={campaign.state === "SENDING" && n("PENDING") > 0 && !capNote}
      />
      <div className="flex flex-wrap gap-3 text-sm">
        {([["SENT", "sent"], ["PENDING", "waiting"], ["FAILED", "failed"], ["UNCERTAIN", "to check"], ["SKIPPED", "not sent"]] as const)
          .filter(([s]) => s === "SENT" || n(s) > 0)
          .map(([s, word]) => (
            <div key={s} className="rounded-lg border border-border px-4 py-2">
              <p className="text-xs text-muted-foreground">{word}</p>
              <p className="text-xl font-semibold tabular-nums">{n(s)}</p>
            </div>
          ))}
      </div>
      {capNote && <p className="text-sm text-muted-foreground">{capNote}</p>}
      {campaign.state === "SCHEDULED" && n("PENDING") === 0 && (
        <p className="text-sm text-muted-foreground">The final list of recipients is picked when it starts sending.</p>
      )}
      {failures.length > 0 && (
        <FailureReview
          campaignId={campaign.id}
          isAdmin={isAdmin}
          rows={failures.map((f) => ({
            id: f.id,
            name: f.name,
            email: f.email,
            action: recoveryFor(f, f.delegateId ? current.get(f.delegateId) : null),
          }))}
        />
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Sent</th></tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-3 py-2"><span className="font-medium">{r.name ?? r.email}</span><span className="block text-xs text-muted-foreground">{r.email}</span></td>
                <td className="px-3 py-2"><Badge variant={r.status === "FAILED" ? "destructive" : "outline"}>{r.status === "UNCERTAIN" ? "to check" : r.status.toLowerCase()}</Badge>{r.error && <span className="block text-xs text-destructive">{r.error}</span>}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.sentAt ? formatDate(r.sentAt) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
