import { ArrowDownRight } from "lucide-react"

export function SocietyHero({ members, dispatches }: { members: number; dispatches: number }) {
  return <section className="relative min-h-[calc(100svh-5rem)] border-b border-foreground/20">
    <div className="paper-grid absolute inset-0 opacity-60" aria-hidden />
    <div className="section-shell relative grid min-h-[calc(100svh-5rem)] lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="flex flex-col justify-center py-16 lg:pr-16">
        <div className="flex flex-wrap items-center gap-4">
          <span className="eyebrow">Delhi Technological University</span>
          <span className="h-px w-16 bg-gold-500" />
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Model United Nations Society</span>
        </div>
        <h1 className="mt-10 max-w-[11ch] font-heading text-[clamp(4.4rem,10.5vw,10rem)] leading-[0.78] tracking-[-0.075em]">
          Learn diplomacy<br /><span className="text-primary">by doing it.</span>
        </h1>
        <div className="mt-12 grid gap-8 border-t border-foreground/25 pt-7 md:grid-cols-[1fr_auto] md:items-end">
          <p className="max-w-2xl text-xl leading-relaxed text-muted-foreground sm:text-2xl">We help DTU students research difficult questions, speak with confidence, negotiate across disagreement, and build the committee rooms where those skills become real.</p>
          <a href="#society-work" className="inline-flex size-16 items-center justify-center rounded-full border border-foreground/30 transition-colors hover:bg-ink hover:text-paper" aria-label="Explore the society"><ArrowDownRight className="size-7" /></a>
        </div>
      </div>
      <aside className="hidden border-l border-foreground/20 lg:flex lg:flex-col lg:justify-between lg:py-10">
        <p className="px-7 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">MUN Society / DTU</p>
        <p className="origin-center rotate-180 px-7 font-heading text-[5.2rem] leading-none text-primary [writing-mode:vertical-rl]">DELTECH</p>
        <div className="grid grid-cols-2 border-t border-foreground/20">
          <div className="p-5"><p className="font-heading text-3xl">{String(members).padStart(2,"0")}</p><p className="mt-1 text-sm text-muted-foreground">active team</p></div>
          <div className="border-l border-foreground/20 p-5"><p className="font-heading text-3xl">{String(dispatches).padStart(2,"0")}</p><p className="mt-1 text-sm text-muted-foreground">dispatches</p></div>
        </div>
      </aside>
    </div>
  </section>
}
