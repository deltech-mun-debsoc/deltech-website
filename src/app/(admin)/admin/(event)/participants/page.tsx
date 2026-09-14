import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event"
import { requireStaff } from "@/lib/authz"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { ParticipantsTable } from "./_components/participants-table"
import { DelegateTabs } from "../registrations/_components/delegate-tabs"

// Participant accounts: people who signed themselves up to register, rather than
// staff anyone invited. They were previously mixed into Users & roles, where they
// both buried the handful of staff rows and offered role controls that make no
// sense for a delegate.
//
// The account is only half the picture, so each row is joined to the Delegate
// application it belongs to. That link is by email, which is how signup creates
// the pair (there is no FK between User and Delegate).
export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"

  const q = (await searchParams).q?.trim() ?? ""

  const users = await prisma.user.findMany({
    where: {
      role: "REGISTERER",
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ email: "asc" }],
    take: 500,
    select: { id: true, email: true, name: true, disabledAt: true, createdAt: true },
  })

  // One query for every matching application rather than one per row.
  const delegates = await prisma.delegate.findMany({
    where: { email: { in: users.map((u) => u.email) }, ...(await currentEventScope()) },
    select: {
      email: true,
      publicToken: true,
      fullName: true,
      institution: true,
      status: true,
      checkedInAt: true,
    },
  })
  const delegateByEmail = new Map(delegates.map((d) => [d.email.toLowerCase(), d]))

  const rows = users.map((u) => {
    const delegate = delegateByEmail.get(u.email.toLowerCase())
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      disabled: !!u.disabledAt,
      createdAt: u.createdAt.toISOString(),
      delegate: delegate
        ? {
            publicToken: delegate.publicToken,
            fullName: delegate.fullName,
            institution: delegate.institution,
            status: delegate.status,
            checkedIn: !!delegate.checkedInAt,
          }
        : null,
    }
  })

  const withoutApplication = rows.filter((r) => !r.delegate).length

  return (
    <div className="space-y-6">
      <DelegateTabs />
      <PageHeader
        eyebrow="Delegates"
        title="Accounts"
        description="Accounts that signed up to register. Each row is joined to its application where one exists. Roles are not editable here: a participant who needs staff access should be given it under Staff & roles."
      >
        <Link
          href="/admin/registrations"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Open registrations
        </Link>
      </PageHeader>

      <form className="flex flex-wrap items-center gap-3">
        <label htmlFor="q" className="sr-only">
          Search participants
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Name or email"
          className="h-9 min-w-56 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{rows.length} accounts</span>
        {/* An account with no application is usually someone who signed up and
            never finished, which is worth being able to see at a glance. */}
        {withoutApplication > 0 && (
          <Badge className="bg-accent font-normal text-accent-foreground">
            {withoutApplication} without an application
          </Badge>
        )}
      </div>

      <ParticipantsTable rows={rows} canManage={isAdmin} />
    </div>
  )
}
