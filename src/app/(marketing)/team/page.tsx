import { prisma } from "@/lib/prisma"
import { FadeUp } from "../_components/motion"
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
    <div>
      <section className="relative overflow-hidden border-b border-border/70 py-20 sm:py-28">
        <div className="paper-grid absolute inset-0 opacity-70" aria-hidden />
        <div className="section-shell relative grid gap-10 lg:grid-cols-[1fr_0.32fr] lg:items-end">
          <FadeUp>
            <p className="eyebrow">DelTech MUN</p>
            <h1 className="mt-5 max-w-[12ch] font-display text-[clamp(3.5rem,7vw,7rem)] font-normal leading-[0.98] tracking-[-0.02em]">
              {t("marketing.teamTitle")}
            </h1>
          </FadeUp>
          <p className="max-w-xs border-l border-foreground/25 pl-6 text-base leading-relaxed text-muted-foreground">
            The secretariat and councils organising DelTech MUN.
          </p>
        </div>
      </section>
      <section className="py-20 sm:py-28">
        <div className="section-shell">
          {members.length === 0 ? (
            <p className="border-y border-border py-16 text-lg text-muted-foreground">{t("marketing.teamEmpty")}</p>
          ) : (
            <TeamDirectory members={publicMembers} />
          )}
        </div>
      </section>
    </div>
  )
}
