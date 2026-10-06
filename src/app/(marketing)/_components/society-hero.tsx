import { ArrowDownRight } from "lucide-react"
import { t } from "@/content/strings"

export function SocietyHero({ members, dispatches }: { members: number; dispatches: number }) {
  return <section className="relative min-h-[calc(100svh-5rem)] border-b border-foreground/20">
    <div className="paper-grid absolute inset-0 opacity-60" aria-hidden />
    <div className="section-shell relative grid min-h-[calc(100svh-5rem)] lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="flex flex-col justify-center py-16 lg:pr-16">
        <div className="flex flex-wrap items-center gap-4">
          <span className="eyebrow">{t("brand.university")}</span>
          <span className="h-px w-16 bg-gold-500" aria-hidden />
          <span className="text-sm font-semibold text-muted-foreground">{t("marketing.societyHeroKicker")}</span>
        </div>
        <h1 className="mt-10 max-w-[11ch] font-display text-[clamp(3.75rem,10vw,9.5rem)] font-[560] leading-[0.92] tracking-[-0.035em] [font-variation-settings:'opsz'_96]">
          {t("marketing.societyHeroTitleA")}<br /><span className="text-primary">{t("marketing.societyHeroTitleB")}</span>
        </h1>
        <div className="mt-12 grid gap-8 border-t border-foreground/25 pt-7 md:grid-cols-[1fr_auto] md:items-end">
          <p className="max-w-2xl text-xl leading-relaxed text-muted-foreground sm:text-2xl">{t("marketing.societyHeroBody")}</p>
          <a href="#society-work" className="inline-flex size-16 items-center justify-center rounded-full border border-foreground/30 transition-colors hover:bg-ink hover:text-paper" aria-label={t("marketing.societyHeroCta")}><ArrowDownRight className="size-7" /></a>
        </div>
      </div>
      <aside className="hidden border-l border-foreground/20 lg:flex lg:flex-col lg:justify-between lg:py-10">
        <p className="px-7 text-sm font-semibold text-muted-foreground">{t("marketing.societyHeroKicker")}</p>
        <p className="origin-center rotate-180 px-7 font-display text-[5.2rem] leading-none text-primary [writing-mode:vertical-rl]" aria-hidden>DELTECH</p>
        <div className="grid grid-cols-2 border-t border-foreground/20">
          <div className="p-5"><p className="font-display text-3xl tabular-nums">{members}</p><p className="mt-1 text-sm text-muted-foreground">{t("marketing.statTeam")}</p></div>
          <div className="border-l border-foreground/20 p-5"><p className="font-display text-3xl tabular-nums">{dispatches}</p><p className="mt-1 text-sm text-muted-foreground">{t("marketing.statArticles")}</p></div>
        </div>
      </aside>
    </div>
  </section>
}
