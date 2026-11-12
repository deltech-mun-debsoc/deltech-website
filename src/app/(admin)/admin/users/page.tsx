import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { UsersTable } from "./_components/users-table"
import { InviteDialog } from "./_components/invite-dialog"
import { PageHeader } from "@/app/(admin)/_components/page-header"

export default async function UsersPage() {
  const session = await requireAdmin()

  // Staff only. Registerers are delegates who signed themselves up, not people
  // anyone invited, and there are far more of them than staff. They live under
  // Participants, where their application is shown alongside the account.
  const users = await prisma.user.findMany({
    where: { role: { not: "REGISTERER" } },
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: { id: true, email: true, name: true, role: true, disabledAt: true },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="System"
        title="Staff & roles"
        description="Disabling keeps the account and what it wrote. Deleting only works for accounts that own nothing."
      >
        <InviteDialog />
      </PageHeader>
      <UsersTable users={users} selfEmail={session.user?.email ?? ""} />
    </div>
  )
}
