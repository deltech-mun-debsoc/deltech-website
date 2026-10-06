import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getContent } from "@/lib/settings";
import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event";
import { t } from "@/content/strings";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FadeUp } from "./_components/motion";
import { SocietyHero } from "./_components/society-hero";
import { ActiveEvent } from "./_components/active-event";
import { ConferenceCarousel } from "./_components/conference-carousel";
import { deriveEventState } from "@/lib/event-state";

const TYPE_LABEL: Record<string, string> = {
  STANDARD: t("marketing.committeeTypes.standard"),
  CRISIS: t("marketing.committeeTypes.crisis"),
  PRESS: t("marketing.committeeTypes.press"),
};

export default async function LandingPage() {
  const [content, committees, portfolioCounts, memberCount, postCount] = await Promise.all([
    getContent(),
    prisma.committee.findMany({
      where: { isActive: true, ...(await currentEventScope()) },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        agenda: true,
        type: true,
        doubleDelegation: true,
      },
    }),
    // The public homepage is force-dynamic, so this ran on every visit. A
    // grouped count is a handful of rows instead of one per seat.
    prisma.portfolio.groupBy({
      by: ["committeeId", "status"],
      where: { committee: await currentEventScope() },
      _count: { _all: true },
    }),
    prisma.member.count({ where: { isActive: true } }),
    prisma.post.count({ where: { status: "PUBLISHED" } }),
  ]);

  const openByCommittee = new Map<string, number>();
  for (const g of portfolioCounts) {
    if (g.status !== "AVAILABLE") continue;
    openByCommittee.set(g.committeeId, (openByCommittee.get(g.committeeId) ?? 0) + g._count._all);
  }
  const openPortfolioCount = [...openByCommittee.values()].reduce((a, b) => a + b, 0);
  const eventState = deriveEventState(content);
  const ctaHref = eventState.acceptsRegistrations ? "/register" : "/register/closed";

  return (
    <div className="overflow-hidden">
      {eventState.showEventHero ? (
        <ActiveEvent content={content} />
      ) : (
        <SocietyHero members={memberCount} dispatches={postCount} />
      )}

      <div className="overflow-hidden border-b border-border/70 bg-ink py-3 text-paper">
        <p className="w-max whitespace-nowrap font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          {t("marketing.principles")} · {t("marketing.principles")}
        </p>
      </div>

      <section id="society-work" className="border-b border-border/70 py-24 sm:py-32">
        <div className="section-shell">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <p className="eyebrow">{eventState.showEventHero ? t("marketing.societyBehindEvent") : t("marketing.societyHowItWorks")}</p>
              <h2 className="display-section mt-5 max-w-[11ch]">{t("marketing.societyWorkTitle")}</h2>
              <p className="body-large mt-7 max-w-xl text-muted-foreground">{t("marketing.societyWorkBody")}</p>
            </div>
            <ol className="border-t border-foreground/20">
              {([
                ["marketing.societyWorkLearn", "marketing.societyWorkLearnBody"],
                ["marketing.societyWorkPractise", "marketing.societyWorkPractiseBody"],
                ["marketing.societyWorkBuild", "marketing.societyWorkBuildBody"],
              ] as const).map(([title, body], index) => (
                <li key={title} className="grid gap-4 border-b border-foreground/20 py-7 sm:grid-cols-[4rem_1fr] sm:py-9">
                  <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                  <div>
                    <h3 className="font-heading text-3xl">{t(title)}</h3>
                    <p className="mt-2 max-w-xl text-base leading-relaxed text-muted-foreground">{t(body)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <ConferenceCarousel />

      {content.publicSections.committees && <section className="py-24 sm:py-32">
        <div className="section-shell">
          <div className="grid gap-8 border-b border-foreground/20 pb-12 lg:grid-cols-[1fr_0.8fr]">
            <div>
              <h2 className="display-section max-w-[11ch]">{t("marketing.committeesTitle")}</h2>
            </div>
            <p className="body-large self-end text-muted-foreground">
              {content.agendasBlurb || t("marketing.committeesBody")}
            </p>
          </div>

          <div>
            {committees.map((committee) => {
              const open = openByCommittee.get(committee.id) ?? 0;
              return (
                <Link
                  key={committee.id}
                  href="/availability"
                  className="group grid gap-4 border-b border-foreground/20 py-8 transition-colors hover:bg-primary/[0.045] sm:grid-cols-[0.9fr_1.2fr_auto] sm:items-center sm:gap-8 sm:px-3"
                >
                  <div>
                    <h3 className="font-heading text-3xl transition-transform duration-300 group-hover:translate-x-1 md:text-4xl">
                      {committee.name}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {TYPE_LABEL[committee.type]}
                      {committee.doubleDelegation ? " · " + t("marketing.doubleDelegation") : ""}
                    </p>
                  </div>
                  <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
                    {committee.agenda || t("marketing.committeeBriefPending")}
                  </p>
                  <div className={cn("flex items-center gap-2 text-sm font-semibold tabular-nums sm:justify-end", open > 0 ? "text-primary" : "text-destructive")}>
                    {open > 0 ? open + " " + t("marketing.openLabel") : t("marketing.statusFull")}
                    <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>}

      {content.publicSections.matrix && <section className="relative overflow-hidden bg-primary py-24 text-primary-foreground sm:py-32">
        <div className="paper-grid absolute inset-0 opacity-15" aria-hidden />
        <div className="section-shell relative grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <h2 className="display-section max-w-[10ch]">{t("marketing.matrixTitle")}</h2>
          </div>
          <div>
            <p className="body-large text-primary-foreground/75">{t("marketing.matrixBody")}</p>
            <div className="mt-9 flex flex-wrap items-center gap-6">
              <Link
                href="/availability"
                className={cn(
                  buttonVariants({ variant: "secondary", size: "lg" }),
                  "bg-background text-foreground hover:bg-background/90",
                )}
              >
                {t("marketing.matrixCta")}
              </Link>
              <p className="flex items-baseline gap-3">
                <span className="font-mono text-6xl font-semibold leading-none tabular-nums">{openPortfolioCount}</span>
                <span className="text-base text-primary-foreground/80">{t("marketing.openPortfolios")}</span>
              </p>
            </div>
          </div>
        </div>
      </section>}

      {content.publicSections.activeEvent && content.awards.length > 0 && (
        <section className="border-b border-border/70 py-24 sm:py-32">
          <div className="section-shell grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="display-section max-w-[9ch]">{t("marketing.awardsTitle")}</h2>
            </div>
            <div className="border-t border-foreground/20">
              {content.awards.map((award, index) => (
                <div key={award} className="flex items-center gap-5 border-b border-foreground/20 py-6">
                  <span className="font-mono text-sm text-gold-700 dark:text-gold-300">0{index + 1}</span>
                  <p className="font-heading text-2xl">{award}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {content.queryContacts.length > 0 && (
        <section className="border-b border-border/70 py-24 sm:py-32">
          <div className="section-shell">
            <FadeUp className="grid gap-8 lg:grid-cols-[1fr_0.8fr]">
              <div>
                <h2 className="display-section max-w-[10ch]">{t("marketing.contactsTitle")}</h2>
              </div>
              <p className="body-large self-end text-muted-foreground">{t("marketing.contactsBody")}</p>
            </FadeUp>
            <div className="mt-12 grid border-t border-foreground/20 sm:grid-cols-2 lg:grid-cols-3">
              {content.queryContacts.map((contact) => (
                <a
                  key={contact.phone}
                  href={"tel:" + contact.phone}
                  className="group border-b border-foreground/20 py-7 sm:border-r sm:px-6 sm:first:pl-0"
                >
                  <p className="data-label text-muted-foreground">{contact.role}</p>
                  <p className="mt-3 font-heading text-2xl">{contact.name}</p>
                  <p className="mt-2 font-mono text-sm tabular-nums text-primary group-hover:underline">
                    {contact.phone}
                  </p>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="noise-wash py-24 text-center sm:py-36">
        <div className="section-shell">
          <h2 className="display-section mx-auto max-w-[12ch]">{t("marketing.finalTitle")}</h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {content.publicSections.registration && <Link href={ctaHref} className={buttonVariants({ size: "lg" })}>
              {eventState.acceptsRegistrations ? content.landingHero.ctaLabel : t("marketing.registrationStatus")}
            </Link>}
            <Link href={content.publicSections.dispatch ? "/blog" : "/team"} className={buttonVariants({ variant: "outline", size: "lg" })}>
              {t("marketing.readDispatch")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
