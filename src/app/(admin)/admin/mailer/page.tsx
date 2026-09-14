import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { formatDate } from "@/lib/datetime"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"

const STATE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline", SCHEDULED: "secondary", SENDING: "default", SENT: "secondary", CANCELLED: "destructive",
}

export default async function MailerPage() {
  await requireStaff()
  const campaigns = await prisma.mailCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, subject: true, audience: true, state: true, scheduledAt: true, finishedAt: true, createdAt: true, createdBy: true },
  })
  const counts = await prisma.mailRecipient.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: campaigns.map((c) => c.id) } },
    _count: { _all: true },
  })
  const tally = (id: string, status: string) =>
    counts.find((c) => c.campaignId === id && c.status === status)?._count._all ?? 0

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Outreach" title="Mailer" description="Announcements to delegates, and PR to the outreach list.">
        <Link href="/admin/mailer/new" className={buttonVariants()}>New mail</Link>
      </PageHeader>
      {campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No mail drafted yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-3 py-2">Subject</th><th className="px-3 py-2">To</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Sent</th><th className="px-3 py-2">When</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-border/60">
                  <td className="px-3 py-2"><Link href={`/admin/mailer/${c.id}`} className="font-medium hover:underline">{c.subject || "(no subject)"}</Link></td>
                  <td className="px-3 py-2 text-xs">{c.audience === "DELEGATES" ? "Delegates" : "Outreach list"}</td>
                  <td className="px-3 py-2"><Badge variant={STATE_VARIANT[c.state]}>{c.state.toLowerCase()}</Badge></td>
                  <td className="px-3 py-2 text-xs tabular-nums">{tally(c.id, "SENT")} sent{tally(c.id, "FAILED") ? ` · ${tally(c.id, "FAILED")} failed` : ""}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(c.finishedAt ?? c.scheduledAt ?? c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
