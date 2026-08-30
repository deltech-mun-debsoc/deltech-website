import { prisma } from "@/lib/prisma"
import { FadeUp } from "../_components/motion"
import { t } from "@/content/strings"
import { TeamDirectory, type PublicTeamMember } from "./_components/team-directory"

export const metadata = {
  title: "Team · DelTech MUN",
  description: "The people behind DelTech MUN.",
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
        <div className="section-shell relative grid gap-12 lg:grid-cols-[1fr_0.42fr] lg:items-end">
          <FadeUp>
            <p className="eyebrow">{t("marketing.teamEyebrow")}</p>
            <h1 className="display-section mt-6 max-w-[10ch]">{t("marketing.teamTitle")}</h1>
            <p className="body-large mt-8 max-w-2xl text-muted-foreground">{t("marketing.teamBody")}</p>
          </FadeUp>
          <div className="border-l border-foreground/20 pl-7">
            <p className="font-mono text-[5rem] font-semibold leading-none tabular-nums text-primary sm:text-[7rem]">
              {String(members.length).padStart(2, "0")}
            </p>
            <p className="data-label mt-4 text-muted-foreground">{t("marketing.activeTeam")}</p>
          </div>
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
