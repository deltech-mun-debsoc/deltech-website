import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { t } from "@/content/strings"
import type { Content } from "@/content/contentSchema"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import hall from "@/photos/hall.webp"

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
    <section className="border-b border-border/70">
      <div className="section-shell grid gap-10 py-12 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{kind}</p>
          <h1 className="headline mt-3 max-w-[16ch]">{content.activeEventName}</h1>
          {content.landingHero.subtitle && <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">{content.landingHero.subtitle}</p>}
          <dl className="mt-7 grid max-w-md grid-cols-2 gap-6 text-base">
            <div><dt className="text-sm text-muted-foreground">{t("marketing.eventDateLabel")}</dt><dd className="mt-1 font-semibold">{content.conferenceDates || t("marketing.datesPending")}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t("marketing.eventVenueLabel")}</dt><dd className="mt-1 font-semibold">{content.venue || t("marketing.venuePending")}</dd></div>
          </dl>
          {sections.registration && (
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-border pt-6">
              <p className="flex items-center gap-2 font-medium">
                <span className={cn("size-2 rounded-full", acceptsRegistrations ? "bg-emerald-600" : "bg-muted-foreground")} aria-hidden />
                {acceptsRegistrations ? t("marketing.registrationOpenStatus") : t("marketing.registrationClosedStatus")}
              </p>
              {next && (
                <Link href={next.href} className={buttonVariants({ size: "lg", variant: acceptsRegistrations ? "default" : "outline" })}>
                  {next.label}<ArrowRight />
                </Link>
              )}
            </div>
          )}
        </div>
        <Image src={hall} alt={t("marketing.gallery.altHall")} placeholder="blur" priority sizes="(min-width: 1024px) 38rem, 100vw" className="aspect-[3/2] w-full rounded-lg object-cover" />
      </div>
    </section>
  )
}
