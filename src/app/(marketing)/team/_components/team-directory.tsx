"use client"

import { useRef } from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"

const TEAM_LEVELS = [
  { value: "AC", label: "Administrative Council", note: "Direction & stewardship" },
  { value: "SC", label: "Senior Council", note: "Strategy & execution" },
  { value: "JC", label: "Junior Council", note: "Ideas & on-ground action" },
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

function MemberCard({ member, index }: { member: PublicTeamMember; index: number }) {
  const initials = member.name.split(" ").slice(0, 2).map((word) => word[0]).join("")

  return (
    <article className="group relative w-[min(78vw,19rem)] shrink-0 snap-start overflow-hidden border border-foreground/20 bg-ink text-paper sm:w-72 lg:w-80">
      {member.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.photoUrl}
          alt={member.name}
          className="aspect-[4/5] w-full object-cover grayscale transition duration-700 group-hover:scale-[1.025] group-hover:grayscale-0"
          loading="lazy"
        />
      ) : (
        <div className="noise-wash flex aspect-[4/5] items-center justify-center bg-background text-foreground">
          <span className="display text-7xl text-gold-700">{initials}</span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/5 to-black/25" />
      <span className="absolute left-4 top-4 border border-white/30 bg-black/25 px-2.5 py-1 font-mono text-[0.65rem] font-bold tabular-nums text-white backdrop-blur-md">
        {String(index + 1).padStart(2, "0")}
      </span>

      {(member.socials.instagram || member.socials.linkedin) && (
        <div className="absolute right-4 top-4 flex gap-2">
          {member.socials.instagram && (
            <a
              href={member.socials.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${member.name} on Instagram`}
              className="flex size-9 items-center justify-center rounded-full border border-white/35 bg-black/30 text-white backdrop-blur-md transition hover:scale-105 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <InstagramMark />
            </a>
          )}
          {member.socials.linkedin && (
            <a
              href={member.socials.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${member.name} on LinkedIn`}
              className="flex size-9 items-center justify-center rounded-full border border-white/35 bg-black/30 text-white backdrop-blur-md transition hover:scale-105 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <LinkedInMark />
            </a>
          )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-6">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-white/70">{member.designation}</p>
        <h3 className="mt-2 font-heading text-3xl leading-[0.9] sm:text-4xl">{member.name}</h3>
      </div>
    </article>
  )
}

function CouncilRail({ level, members }: { level: (typeof TEAM_LEVELS)[number]; members: PublicTeamMember[] }) {
  const railRef = useRef<HTMLDivElement>(null)

  function move(direction: -1 | 1) {
    railRef.current?.scrollBy({ left: direction * Math.min(railRef.current.clientWidth * 0.85, 1050), behavior: "smooth" })
  }

  if (members.length === 0) return null

  return (
    <section aria-labelledby={`team-${level.value.toLowerCase()}`}>
      <div className="mb-6 flex items-end justify-between gap-5 border-b border-foreground/25 pb-5">
        <div className="flex min-w-0 items-end gap-4 sm:gap-6">
          <span className="font-mono text-3xl font-bold text-primary sm:text-5xl">{level.value}</span>
          <div className="min-w-0">
            <h2 id={`team-${level.value.toLowerCase()}`} className="font-heading text-3xl leading-none sm:text-5xl">
              {level.label}
            </h2>
            <p className="mt-2 hidden text-sm text-muted-foreground sm:block">{level.note}</p>
          </div>
          <span className="mb-0.5 rounded-full border border-foreground/25 px-2 py-1 font-mono text-[0.65rem] tabular-nums sm:mb-1">
            {String(members.length).padStart(2, "0")}
          </span>
        </div>

        {members.length > 4 && (
          <div className="hidden shrink-0 gap-2 sm:flex">
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label={`Scroll ${level.label} backward`}
              className="flex size-11 items-center justify-center border border-foreground/30 transition hover:bg-ink hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              aria-label={`Scroll ${level.label} forward`}
              className="flex size-11 items-center justify-center border border-foreground/30 transition hover:bg-ink hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={railRef}
        className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-8 sm:gap-5 sm:px-8 lg:mx-0 lg:px-0"
      >
        {members.map((member, index) => (
          <MemberCard key={member.id} member={member} index={index} />
        ))}
      </div>
      {members.length > 2 && (
        <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground sm:hidden">
          Swipe to meet the council →
        </p>
      )}
    </section>
  )
}

export function TeamDirectory({ members }: { members: PublicTeamMember[] }) {
  return (
    <div className="space-y-16 sm:space-y-24">
      {TEAM_LEVELS.map((level) => (
        <CouncilRail
          key={level.value}
          level={level}
          members={members.filter((member) => member.level === level.value)}
        />
      ))}
    </div>
  )
}
