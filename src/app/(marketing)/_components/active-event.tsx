import Link from "next/link"
import { Asterisk, ArrowRight } from "lucide-react"
import { t } from "@/content/strings"
import type { Content } from "@/content/contentSchema"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The home page's opening: what is happening, when and where, whether you can
// register, and the one thing to do next.
export function ActiveEvent({ content, acceptsRegistrations }: { content: Content; acceptsRegistrations: boolean }) {
  const kind = content.activeEventLabel || (content.eventMode === "INTRA_MUN" ? t("marketing.eventKindIntra") : t("marketing.eventKindFlagship"))
  const sections = content.publicSections
  const next = acceptsRegistrations
    ? { href: "/register", label: content.landingHero.ctaLabel || t("nav.register") }
    : sections.matrix
      ? { href: "/availability", label: t("marketing.seeCommittees") }
      : sections.dispatch
        ? { href: "/blog", label: t("marketing.readDispatch") }
        : null

  return (
    <section className="relative overflow-hidden bg-ink text-paper">
      <Asterisk className="absolute -right-16 -top-20 size-[30rem] text-paper/[0.035]" strokeWidth={0.6} aria-hidden />
      <div className="section-shell relative grid gap-12 py-20 sm:py-32 lg:grid-cols-[1fr_0.62fr] lg:items-end">
        <div>
          <p className="text-sm font-medium text-gold-300">{kind}</p>
          <h1 className="mt-7 max-w-[18ch] font-display text-[clamp(3.75rem,7vw,7rem)] font-normal leading-[0.98] tracking-[-0.02em]">{content.activeEventName}</h1>
          {content.landingHero.subtitle && <p className="mt-8 max-w-xl text-xl leading-relaxed text-paper/75">{content.landingHero.subtitle}</p>}
        </div>
        <div className="border-t border-paper/25 pt-7">
          <dl className="grid grid-cols-2 gap-px bg-paper/20">
            <div className="bg-ink p-5"><dt className="text-sm text-paper/65">{t("marketing.eventDateLabel")}</dt><dd className="mt-3 text-lg font-semibold">{content.conferenceDates || t("marketing.datesPending")}</dd></div>
            <div className="bg-ink p-5"><dt className="text-sm text-paper/65">{t("marketing.eventVenueLabel")}</dt><dd className="mt-3 text-lg font-semibold">{content.venue || t("marketing.venuePending")}</dd></div>
          </dl>
          {sections.registration && <p className="mt-6 flex items-center gap-2 text-sm text-paper/70"><span className={cn("size-2 rounded-full", acceptsRegistrations ? "bg-emerald-400" : "bg-paper/50")} aria-hidden />{acceptsRegistrations ? t("marketing.registrationOpenStatus") : t("marketing.registrationClosedStatus")}</p>}
          {next && <Link href={next.href} className={cn(buttonVariants({ size: "lg" }), "mt-5 bg-gold-500 text-stone-950 hover:bg-gold-300")}>{next.label}<ArrowRight /></Link>}
        </div>
      </div>
    </section>
  )
}
