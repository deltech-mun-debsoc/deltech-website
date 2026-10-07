import { t } from "@/content/strings"

const TEAM_LEVELS = [
  { value: "AC", label: "Administrative Council" },
  { value: "SC", label: "Senior Council" },
  { value: "JC", label: "Junior Council" },
] as const

type TeamLevel = (typeof TEAM_LEVELS)[number]["value"]

function InstagramMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" className="fill-current stroke-none" />
    </svg>
  )
}

function LinkedInMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current">
      <path d="M5.2 3.6A2.1 2.1 0 1 1 5.2 7.8 2.1 2.1 0 0 1 5.2 3.6ZM3.4 9.4H7v11.2H3.4V9.4Zm5.7 0h3.4v1.5h.1c.5-.9 1.7-1.9 3.5-1.9 3.7 0 4.4 2.4 4.4 5.6v6h-3.6v-5.3c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.4H9.1V9.4Z" />
    </svg>
  )
}

export type PublicTeamMember = {
  id: string
  name: string
  designation: string
  level: TeamLevel
  photoUrl: string | null
  socials: { instagram?: string; linkedin?: string }
}

const SOCIAL = "flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function MemberCard({ member }: { member: PublicTeamMember }) {
  const initials = member.name.split(" ").slice(0, 2).map((word) => word[0]).join("")

  return (
    <li>
      {member.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.photoUrl} alt={member.name} loading="lazy" className="aspect-[4/5] w-full rounded-lg bg-muted object-cover object-[center_28%]" />
      ) : (
        <div aria-hidden className="flex aspect-[4/5] items-center justify-center rounded-lg bg-muted text-4xl font-semibold text-muted-foreground">{initials}</div>
      )}
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{member.name}</h3>
          <p className="text-sm text-muted-foreground">{member.designation}</p>
        </div>
        {(member.socials.instagram || member.socials.linkedin) && (
          <div className="-mr-1.5 flex shrink-0">
            {member.socials.instagram && (
              <a href={member.socials.instagram} target="_blank" rel="noopener noreferrer" aria-label={t("marketing.instagramLabel", { name: member.name })} className={SOCIAL}>
                <InstagramMark />
              </a>
            )}
            {member.socials.linkedin && (
              <a href={member.socials.linkedin} target="_blank" rel="noopener noreferrer" aria-label={t("marketing.linkedinLabel", { name: member.name })} className={SOCIAL}>
                <LinkedInMark />
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export function TeamDirectory({ members }: { members: PublicTeamMember[] }) {
  return (
    <div className="space-y-14">
      {TEAM_LEVELS.map((level) => {
        const people = members.filter((member) => member.level === level.value)
        if (people.length === 0) return null
        return (
          <section key={level.value} aria-labelledby={`team-${level.value.toLowerCase()}`}>
            <h2 id={`team-${level.value.toLowerCase()}`} className="text-xl font-semibold">{level.label}</h2>
            {/* A large council gets smaller cards so a phone is not one long scroll. */}
            <ul className={people.length > 8
              ? "mt-5 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 lg:grid-cols-6"
              : "mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4"}>
              {people.map((member) => <MemberCard key={member.id} member={member} />)}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
