import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getActiveEvent } from "@/lib/event"
import { formatDate } from "@/lib/datetime"
import { Badge } from "@/components/ui/badge"

const STATE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline", SCHEDULED: "secondary", SENDING: "default", SENT: "secondary", CANCELLED: "destructive",
}

// Event mail shows this event's campaigns (plus drafts made before a campaign
// carried its event); PR outreach shows every outreach campaign. Neither list
// ever shows the other audience.
export async function CampaignList({ audience }: { audience: "DELEGATES" | "CONTACTS" }) {
  const base = audience === "CONTACTS" ? "/admin/outreach" : "/admin/mailer"
  const event = audience === "DELEGATES" ? await getActiveEvent() : null
  const campaigns = await prisma.mailCampaign.findMany({
    where: { audience, ...(audience === "DELEGATES" ? { OR: [{ eventId: event?.id ?? "__no-active-event__" }, { eventId: null }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, subject: true, state: true, scheduledAt: true, finishedAt: true, createdAt: true },
  })
  const counts = await prisma.mailRecipient.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: campaigns.map((c) => c.id) } },
    _count: { _all: true },
  })
  const tally = (id: string, status: string) =>
    counts.find((c) => c.campaignId === id && c.status === status)?._count._all ?? 0

  if (campaigns.length === 0) return <p className="text-sm text-muted-foreground">No mail drafted yet.</p>

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr><th className="px-3 py-2">Subject</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Sent</th><th className="px-3 py-2">When</th></tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-t border-border/60">
              <td className="px-3 py-2"><Link href={`${base}/${c.id}`} className="font-medium hover:underline">{c.subject || "(no subject)"}</Link></td>
              <td className="px-3 py-2"><Badge variant={STATE_VARIANT[c.state]}>{c.state.toLowerCase()}</Badge></td>
              <td className="px-3 py-2 text-xs tabular-nums">{tally(c.id, "SENT")} sent{tally(c.id, "FAILED") ? ` · ${tally(c.id, "FAILED")} failed` : ""}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(c.finishedAt ?? c.scheduledAt ?? c.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
