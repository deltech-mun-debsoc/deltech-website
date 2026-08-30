import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { TeamManager } from "./_components/team-manager"
import { PageHeader } from "@/app/(admin)/_components/page-header"

export default async function AdminTeamPage() {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"

  const members = await prisma.member.findMany({
    orderBy: [{ level: "asc" }, { order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      designation: true,
      level: true,
      order: true,
      imageUrl: true,
      photoMimeType: true,
      socials: true,
      isActive: true,
      updatedAt: true,
    },
  })

  const serialized = members.map((m) => ({
    id: m.id,
    name: m.name,
    designation: m.designation,
    level: m.level,
    order: m.order,
    imageUrl: m.photoMimeType
      ? `/api/team-photo/${m.id}?v=${m.updatedAt.getTime()}`
      : m.imageUrl,
    socials: (m.socials as { instagram?: string; linkedin?: string } | null) ?? {},
    isActive: m.isActive,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Content"
        title="Team"
        description="Society members shown on the public /team page. Order controls display position."
      />
      <TeamManager members={serialized} isAdmin={isAdmin} />
    </div>
  )
}
