import { requireStaff } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { prMailEnabled } from "@/lib/mailer/queue"
import { EMAIL_TRANSPORT_NAME } from "@/lib/resend"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { ContactsManager } from "../_components/contacts-manager"

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const { q = "" } = await searchParams
  const where = q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : {}
  const [contacts, total, unsubscribed, bounced, prOn] = await Promise.all([
    prisma.mailContact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, email: true, name: true, institution: true, tags: true, unsubscribedAt: true, bouncedAt: true, lastMailedAt: true },
    }),
    prisma.mailContact.count(),
    prisma.mailContact.count({ where: { unsubscribedAt: { not: null } } }),
    prisma.mailContact.count({ where: { bouncedAt: { not: null } } }),
    prMailEnabled(),
  ])
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Mailer" title="Outreach contacts" description={`${total} on the list · ${unsubscribed} unsubscribed · ${bounced} bounced`} />
      <ContactsManager
        contacts={contacts.map((c) => ({
          ...c,
          unsubscribedAt: c.unsubscribedAt?.toISOString() ?? null,
          bouncedAt: c.bouncedAt?.toISOString() ?? null,
          lastMailedAt: c.lastMailedAt?.toISOString() ?? null,
        }))}
        prOn={prOn}
        isAdmin={isAdmin}
        transport={EMAIL_TRANSPORT_NAME}
        q={q}
      />
    </div>
  )
}
