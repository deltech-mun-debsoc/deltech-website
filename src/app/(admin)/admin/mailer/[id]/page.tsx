import { notFound } from "next/navigation"
import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { formatDate } from "@/lib/datetime"
import { prMailEnabled } from "@/lib/mailer/queue"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { Badge } from "@/components/ui/badge"
import { Composer } from "../_components/composer"
import { CampaignActions } from "../_components/campaign-actions"

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const campaign = await prisma.mailCampaign.findUnique({ where: { id } })
  if (!campaign) notFound()

  if (campaign.state === "DRAFT") {
    const [committees, tagRows, prOn] = await Promise.all([
      prisma.committee.findMany({ where: { isActive: true, ...(await currentEventScope()) }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
      prisma.mailContact.findMany({ where: { unsubscribedAt: null }, select: { tags: true } }),
      prMailEnabled(),
    ])
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Mailer · draft" title={campaign.subject || "Untitled mail"} description={`Drafted by ${campaign.createdBy}`} />
        <CampaignActions id={campaign.id} state={campaign.state} isAdmin={isAdmin} />
        <Composer
          campaign={{ ...campaign, filters: campaign.filters }}
          committees={committees}
          tags={[...new Set(tagRows.flatMap((r) => r.tags))].sort()}
          prOn={prOn}
          isAdmin={isAdmin}
        />
      </div>
    )
  }

  const [grouped, recipients] = await Promise.all([
    prisma.mailRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
    prisma.mailRecipient.findMany({
      where: { campaignId: id },
      orderBy: [{ status: "asc" }, { email: "asc" }],
      take: 300,
      select: { id: true, email: true, name: true, status: true, error: true, sentAt: true },
    }),
  ])
  const n = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Mailer · ${campaign.audience === "DELEGATES" ? "delegates" : "outreach list"}`}
        title={campaign.subject}
        description={`${campaign.state.toLowerCase()} · by ${campaign.createdBy}${campaign.scheduledAt ? ` · for ${formatDate(campaign.scheduledAt)}` : ""}`}
      />
      <CampaignActions id={campaign.id} state={campaign.state} isAdmin={isAdmin} />
      <div className="flex flex-wrap gap-3 text-sm">
        {(["SENT", "PENDING", "SENDING", "FAILED", "SKIPPED"] as const).map((s) => (
          <div key={s} className="rounded-lg border border-border px-4 py-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.toLowerCase()}</p>
            <p className="text-xl font-semibold tabular-nums">{n(s)}</p>
          </div>
        ))}
      </div>
      {campaign.state === "SCHEDULED" && n("PENDING") === 0 && (
        <p className="text-sm text-muted-foreground">Recipients are worked out when it starts sending, so the list appears then.</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Sent</th></tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-3 py-2"><span className="font-medium">{r.name ?? r.email}</span><span className="block text-xs text-muted-foreground">{r.email}</span></td>
                <td className="px-3 py-2"><Badge variant={r.status === "FAILED" ? "destructive" : "outline"}>{r.status.toLowerCase()}</Badge>{r.error && <span className="block text-xs text-destructive">{r.error}</span>}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.sentAt ? formatDate(r.sentAt) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
