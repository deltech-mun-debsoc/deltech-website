import Link from "next/link"
import Image from "next/image"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { t } from "@/content/strings"
import cohort from "@/photos/cohort.webp"

// Between events, keep the society's editorial identity without inventing
// event statistics or implying that registration is open.
export function SocietyHero({ showTeam }: { showTeam: boolean }) {
  return (
    <section className="relative overflow-hidden border-b border-foreground/20">
      <div className="paper-grid absolute inset-0 opacity-60" aria-hidden />
      <div className="section-shell relative grid min-h-[calc(100svh-5rem)] lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <div className="flex flex-col justify-center py-16 lg:py-24 lg:pr-16">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-muted-foreground">Delhi Technological University</span>
            <span className="h-px w-14 bg-gold-500" aria-hidden />
          </div>
          <h1 className="mt-9 max-w-[11ch] font-display text-[clamp(3.7rem,8vw,8.5rem)] font-normal leading-[0.92] tracking-[-0.025em]">
            {t("marketing.societyHeroTitleA")}<br />
            <span className="text-primary">{t("marketing.societyHeroTitleB")}</span>
          </h1>
          <div className="mt-11 flex flex-wrap items-end justify-between gap-7 border-t border-foreground/25 pt-7">
            <p className="max-w-md text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Workshops, Intra MUN, and a student-run conference at DTU.
            </p>
            <a href="#society-work" aria-label="Explore the society" className="flex size-14 shrink-0 items-center justify-center rounded-full border border-foreground/35 transition-colors hover:bg-ink hover:text-paper">
              <ArrowDownRight className="size-6" />
            </a>
          </div>
        </div>
        <aside className="relative flex min-h-72 items-end overflow-hidden border-t border-foreground/20 lg:min-h-full lg:border-l lg:border-t-0">
          <Image src={cohort} alt={t("marketing.gallery.altCohort")} placeholder="blur" priority fill sizes="(min-width: 1024px) 38vw, 100vw" className="object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" aria-hidden />
          <div className="relative flex w-full items-end justify-between gap-4 p-6 text-white sm:p-8">
            <p className="max-w-[14rem] text-sm font-medium">The society at Delhi Technological University</p>
            {showTeam && (
              <Link href="/team" className="inline-flex items-center gap-2 border-b border-white/70 pb-1 text-sm font-semibold hover:border-white">
                Meet the team <ArrowUpRight className="size-4" />
              </Link>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
