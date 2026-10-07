import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { TeamDirectory, type PublicTeamMember } from "./_components/team-directory"

export const metadata = {
  title: "Team · DelTech MUN",
  description: "The DelTech MUN secretariat and councils.",
}

export const revalidate = 0

export default async function TeamPage() {
  const members = await prisma.member.findMany({
    where: { isActive: true },
    orderBy: [{ level: "asc" }, { order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      designation: true,
      level: true,
      imageUrl: true,
      photoMimeType: true,
      socials: true,
      updatedAt: true,
    },
  })

  const publicMembers: PublicTeamMember[] = members.map((member) => ({
    id: member.id,
    name: member.name,
    designation: member.designation,
    level: member.level,
    photoUrl: member.photoMimeType
      ? `/api/team-photo/${member.id}?v=${member.updatedAt.getTime()}`
      : member.imageUrl,
    socials: (member.socials as { instagram?: string; linkedin?: string } | null) ?? {},
  }))

  return (
    <div className="section-shell py-12 sm:py-16">
      <h1 className="headline">{t("marketing.teamTitle")}</h1>
      <div className="mt-10">
        {members.length === 0 ? (
          <p className="text-lg text-muted-foreground">{t("marketing.teamEmpty")}</p>
        ) : (
          <TeamDirectory members={publicMembers} />
        )}
      </div>
    </div>
  )
}
