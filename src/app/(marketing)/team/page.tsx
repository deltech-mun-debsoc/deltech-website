import { ArrowUpRight } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { FadeUp } from "../_components/motion"
import { t } from "@/content/strings"

export const metadata = {
  title: "Team · DelTech MUN",
  description: "The people behind DelTech MUN.",
}

export const revalidate = 0

const TEAM_LEVELS = [
  { value: "AC", label: "Administrative Council" },
  { value: "SC", label: "Senior Council" },
  { value: "JC", label: "Junior Council" },
] as const

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
            <div className="space-y-20">
              {TEAM_LEVELS.map((level) => {
                const sectionMembers = members.filter((member) => member.level === level.value)
                if (sectionMembers.length === 0) return null

                return (
                  <section key={level.value} aria-labelledby={`team-${level.value.toLowerCase()}`}>
                    <div className="flex items-end justify-between border-b border-foreground/30 pb-5">
                      <div>
                        <p className="data-label text-primary">{level.value}</p>
                        <h2 id={`team-${level.value.toLowerCase()}`} className="mt-2 font-heading text-4xl sm:text-6xl">
                          {level.label}
                        </h2>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {String(sectionMembers.length).padStart(2, "0")}
                      </span>
                    </div>
                    <div>
                      {sectionMembers.map((member, index) => {
                        const socials = (member.socials as { instagram?: string; linkedin?: string } | null) ?? {}
                        const initials = member.name.split(" ").slice(0, 2).map((word) => word[0]).join("")
                        const photoUrl = member.photoMimeType
                          ? `/api/team-photo/${member.id}?v=${member.updatedAt.getTime()}`
                          : member.imageUrl

                        return (
                          <article key={member.id} className="group grid gap-7 border-b border-foreground/20 py-9 sm:grid-cols-[4rem_11rem_1fr_auto] sm:items-center sm:py-12">
                            <span className="font-mono text-sm font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span>
                            {photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={photoUrl} alt={member.name} className="aspect-[4/5] w-36 border border-foreground/15 object-cover grayscale transition duration-500 group-hover:grayscale-0 sm:w-44" loading="lazy" />
                            ) : (
                              <div className="noise-wash flex aspect-[4/5] w-36 items-end border border-foreground/15 p-4 sm:w-44">
                                <span className="display text-5xl text-gold-700">{initials}</span>
                              </div>
                            )}
                            <div>
                              <p className="data-label text-muted-foreground">{member.designation}</p>
                              <h3 className="mt-3 font-heading text-4xl leading-none md:text-5xl">{member.name}</h3>
                            </div>
                            {(socials.instagram || socials.linkedin) && (
                              <div className="flex flex-col items-start gap-2 sm:items-end">
                                {socials.instagram && (
                                  <a href={socials.instagram} target="_blank" rel="noopener noreferrer" aria-label={t("marketing.instagramLabel", { name: member.name })} className="ink-link inline-flex items-center gap-2 text-sm font-semibold">
                                    Instagram <ArrowUpRight className="size-4" />
                                  </a>
                                )}
                                {socials.linkedin && (
                                  <a href={socials.linkedin} target="_blank" rel="noopener noreferrer" aria-label={t("marketing.linkedinLabel", { name: member.name })} className="ink-link inline-flex items-center gap-2 text-sm font-semibold">
                                    LinkedIn <ArrowUpRight className="size-4" />
                                  </a>
                                )}
                              </div>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
