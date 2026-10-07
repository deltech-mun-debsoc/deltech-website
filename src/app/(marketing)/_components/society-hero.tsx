import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { t } from "@/content/strings"
import { buttonVariants } from "@/components/ui/button"
import cohort from "@/photos/cohort.webp"

// Shown between events: who the society is, and a way to meet it.
export function SocietyHero({ showTeam }: { showTeam: boolean }) {
  return (
    <section className="border-b border-border/70">
      <div className="section-shell grid gap-10 py-12 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16">
        <div>
          <h1 className="headline">{t("brand.name")}</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">{t("marketing.societyHeroBody")}</p>
          {showTeam && (
            <Link href="/team" className={buttonVariants({ size: "lg", variant: "outline", className: "mt-8" })}>
              {t("marketing.meetTheTeam")}<ArrowRight />
            </Link>
          )}
        </div>
        <Image src={cohort} alt={t("marketing.gallery.altCohort")} placeholder="blur" priority sizes="(min-width: 1024px) 38rem, 100vw" className="aspect-[3/2] w-full rounded-lg object-cover" />
      </div>
    </section>
  )
}
