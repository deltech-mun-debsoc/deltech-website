import Link from "next/link";
import { ArrowRight, RadioTower } from "lucide-react";
import { getContent } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
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
      where: { isActive: true },
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

      <div className="overflow-hidden border-b border-border/70 bg-foreground py-3 text-background">
        <p className="w-max whitespace-nowrap font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          {t("marketing.principles")} · {t("marketing.principles")}
        </p>
      </div>

      <section id="society-work" className="border-b border-border/70 py-24 sm:py-32">
        <div className="section-shell">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <p className="eyebrow">{eventState.showEventHero ? "The society behind the event" : "How the society works"}</p>
              <h2 className="display-section mt-5 max-w-[11ch]">Start curious. Learn the room. Help build the next one.</h2>
              <p className="body-large mt-7 max-w-xl text-muted-foreground">
                DelTech MUN is DTU&apos;s student-run Model United Nations society. Members learn research, procedure, speaking, and negotiation by practising together, then use those skills to run simulations, publish ideas, and organise conferences.
              </p>
            </div>
            <ol className="border-t border-foreground/20">
              {[
                ["Learn", "Workshops turn unfamiliar rules into usable skills: how to research a country, write a position, speak clearly, negotiate, and draft a resolution."],
                ["Practise", "Free campus simulations give first-timers a real committee room and give experienced delegates harder problems to solve."],
                ["Build", "Students research agendas, chair committees, write the Dispatch, manage delegate journeys, and leave the society stronger for the next team."],
              ].map(([title, body], index) => (
                <li key={title} className="grid gap-4 border-b border-foreground/20 py-7 sm:grid-cols-[4rem_1fr] sm:py-9">
                  <span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                  <div>
                    <h3 className="font-heading text-2xl">{title}</h3>
                    <p className="mt-2 max-w-xl text-base leading-relaxed text-muted-foreground">{body}</p>
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
              <p className="eyebrow">{t("marketing.committeesEyebrow")}</p>
              <h2 className="display-section mt-5 max-w-[11ch]">{t("marketing.committeesTitle")}</h2>
            </div>
            <p className="body-large self-end text-muted-foreground">
              {content.agendasBlurb || t("marketing.committeesBody")}
            </p>
          </div>

          <div>
            {committees.map((committee, index) => {
              const open = openByCommittee.get(committee.id) ?? 0;
              return (
                <Link
                  key={committee.id}
                  href="/availability"
                  className="group grid gap-5 border-b border-foreground/20 py-8 transition-colors hover:bg-primary/[0.045] sm:grid-cols-[4rem_0.9fr_1.2fr_auto] sm:items-center sm:px-3"
                >
                  <span className="font-mono text-sm font-semibold text-muted-foreground">0{index + 1}</span>
                  <div>
                    <h3 className="font-heading text-3xl transition-transform duration-300 group-hover:translate-x-1 md:text-4xl">
                      {committee.name}
                    </h3>
                    <p className="data-label mt-2 text-[0.6875rem] text-muted-foreground">
                      {TYPE_LABEL[committee.type]}
                      {committee.doubleDelegation ? " · " + t("marketing.doubleDelegation") : ""}
                    </p>
                  </div>
                  <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
                    {committee.agenda || t("marketing.committeeBriefPending")}
                  </p>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <span className={open > 0 ? "signal-dot" : "size-2 rounded-full bg-destructive"} />
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {open} {t("marketing.openLabel")}
                    </span>
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
            <p className="data-label flex items-center gap-3 text-gold-300">
              <RadioTower className="size-4" />
              {t("marketing.matrixEyebrow")}
            </p>
            <h2 className="display-section mt-6 max-w-[10ch]">{t("marketing.matrixTitle")}</h2>
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
              <p className="font-mono text-3xl font-semibold tabular-nums">
                {String(openPortfolioCount).padStart(2, "0")}
                <span className="ml-2 text-sm uppercase tracking-[0.12em] text-primary-foreground/60">
                  {t("marketing.openLabel")}
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>}

      {content.publicSections.activeEvent && content.awards.length > 0 && (
        <section className="border-b border-border/70 py-24 sm:py-32">
          <div className="section-shell grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="eyebrow">{t("landing.sectionAwards")}</p>
              <h2 className="display-section mt-5 max-w-[9ch]">{t("marketing.awardsTitle")}</h2>
            </div>
            <div className="border-t border-foreground/20">
              {content.awards.map((award, index) => (
                <div key={award} className="flex items-center gap-5 border-b border-foreground/20 py-6">
                  <span className="font-mono text-sm text-gold-700">0{index + 1}</span>
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
                <p className="eyebrow">{t("landing.sectionContacts")}</p>
                <h2 className="display-section mt-5 max-w-[10ch]">{t("marketing.contactsTitle")}</h2>
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
                  <p className="mt-2 font-mono text-sm text-primary transition-transform group-hover:translate-x-1">
                    {contact.phone} ↗
                  </p>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="noise-wash py-24 text-center sm:py-36">
        <div className="section-shell">
          <p className="eyebrow">{t("marketing.finalEyebrow")}</p>
          <h2 className="display-section mx-auto mt-6 max-w-[12ch]">{t("marketing.finalTitle")}</h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {content.publicSections.registration && <Link href={ctaHref} className={buttonVariants({ size: "lg" })}>
              {eventState.acceptsRegistrations ? content.landingHero.ctaLabel : "Registration status"}
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
