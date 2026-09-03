import Link from "next/link"
import { Asterisk, ArrowRight } from "lucide-react"
import type { Content } from "@/content/contentSchema"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ActiveEvent({ content }: { content: Content }) {
  if (!content.publicSections.activeEvent || !content.activeEventName) return null
  const kind = content.eventMode === "INTRA_MUN"
    ? "Free campus simulation"
    : "Flagship conference"
  const eventBrief = content.landingHero.subtitle || (
    content.eventMode === "INTRA_MUN"
      ? "A practice committee for DTU students to learn procedure, test ideas, and take the floor without a registration fee."
      : "DelTech MUN brings delegates together to research a position, negotiate under pressure, and turn disagreement into workable resolutions."
  )
  return <section className="relative overflow-hidden bg-ink text-paper">
    <Asterisk className="absolute -right-16 -top-20 size-[30rem] text-paper/[0.035]" strokeWidth={0.6} aria-hidden />
    <div className="section-shell relative grid gap-12 py-24 lg:grid-cols-[1fr_0.62fr] lg:items-end sm:py-32">
      <div><p className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-gold-300">{content.activeEventLabel || kind}</p><h1 className="mt-7 max-w-[10ch] font-heading text-6xl leading-[0.88] sm:text-8xl">{content.activeEventName}</h1><p className="mt-7 max-w-xl text-xl leading-relaxed text-paper/70">{eventBrief}</p></div>
      <div className="border-t border-paper/25 pt-7">
        <dl className="grid grid-cols-2 gap-px bg-paper/20"><div className="bg-ink p-5"><dt className="font-mono text-xs uppercase tracking-wider text-paper/50">Date</dt><dd className="mt-3 text-lg font-semibold">{content.conferenceDates || "To be announced"}</dd></div><div className="bg-ink p-5"><dt className="font-mono text-xs uppercase tracking-wider text-paper/50">Venue</dt><dd className="mt-3 text-lg font-semibold">{content.venue || "DTU campus"}</dd></div></dl>
        {/* gold-400 was never a defined shade (the app's own scale is 300/500/700
            only), so the utility below used to generate no rule at all: this
            button had no background until hover, where gold-300 does exist. */}
        <div className="mt-7 flex flex-wrap gap-3">
          {content.publicSections.registration && <Link href={content.registrationOpen ? "/register" : "/register/closed"} className={cn(buttonVariants({ size: "lg" }), "bg-gold-500 text-stone-950 hover:bg-gold-300")}>{content.registrationOpen ? content.landingHero.ctaLabel : "See registration status"}<ArrowRight /></Link>}
          {content.publicSections.matrix && <Link href="/availability" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "border-paper/30 text-paper hover:bg-paper hover:text-ink")}>View matrix</Link>}
        </div>
      </div>
    </div>
  </section>
}
