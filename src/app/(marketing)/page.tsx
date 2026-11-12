import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getContent } from "@/lib/settings";
import { prisma } from "@/lib/prisma"
import { currentEventScope } from "@/lib/event";
import { t } from "@/content/strings";
import { cn } from "@/lib/utils";
import { SocietyHero } from "./_components/society-hero";
import { ActiveEvent } from "./_components/active-event";
import { ConferenceCarousel } from "./_components/conference-carousel";
import { deriveEventState } from "@/lib/event-state";

const TYPE_LABEL: Record<string, string> = {
  STANDARD: t("marketing.committeeTypes.standard"),
  CRISIS: t("marketing.committeeTypes.crisis"),
  PRESS: t("marketing.committeeTypes.press"),
};

const ACTIVITIES = [
  { title: "marketing.activityWorkshops", body: "marketing.activityWorkshopsBody", href: null },
  { title: "marketing.activityIntra", body: "marketing.activityIntraBody", href: null },
  { title: "marketing.activityConference", body: "marketing.activityConferenceBody", href: null },
  { title: "marketing.activityDispatch", body: "marketing.activityDispatchBody", href: "/blog" },
] as const;

export default async function LandingPage() {
  const [content, committees, portfolioCounts] = await Promise.all([
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
  ]);

  const openByCommittee = new Map<string, number>();
  for (const g of portfolioCounts) {
    if (g.status !== "AVAILABLE") continue;
    openByCommittee.set(g.committeeId, (openByCommittee.get(g.committeeId) ?? 0) + g._count._all);
  }
  const eventState = deriveEventState(content);
  const sections = content.publicSections;
  const showCommittees = eventState.showEventHero && sections.committees && committees.length > 0;

  return (
    <div className="overflow-hidden">
      {eventState.showEventHero ? (
        <ActiveEvent content={content} acceptsRegistrations={eventState.acceptsRegistrations} />
      ) : (
        <SocietyHero showTeam={sections.team} />
      )}

      <div className="border-b border-border/70 bg-ink px-4 py-3 text-center text-sm font-medium tracking-[0.08em] text-paper">
        DTU Intra MUN <span className="mx-4 text-gold-300" aria-hidden>·</span> DelTech MUN <span className="mx-4 text-gold-300" aria-hidden>·</span> The Dispatch
      </div>

      {showCommittees && <section className="border-b border-border/70 py-16 sm:py-20">
        <div className="section-shell">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="text-2xl font-semibold sm:text-3xl">{t("marketing.committeesTitle")}</h2>
            {sections.matrix && <Link href="/availability" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
              {t("marketing.viewMatrix")}<ArrowRight className="size-4" />
            </Link>}
          </div>
          <ul className="mt-8 divide-y divide-border border-y border-border">
            {committees.map((committee) => {
              const open = openByCommittee.get(committee.id) ?? 0;
              return (
                <li key={committee.id} className="grid gap-2 py-5 sm:grid-cols-[14rem_1fr_auto] sm:items-baseline sm:gap-8">
                  <div>
                    <h3 className="text-lg font-semibold">{committee.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {TYPE_LABEL[committee.type]}
                      {committee.doubleDelegation ? " · " + t("marketing.doubleDelegation") : ""}
                    </p>
                  </div>
                  <p className="text-base leading-relaxed text-muted-foreground">
                    {committee.agenda || t("marketing.committeeBriefPending")}
                  </p>
                  {sections.matrix && <p className={cn("text-sm font-semibold tabular-nums", open > 0 ? "text-primary" : "text-muted-foreground")}>
                    {open > 0 ? t("marketing.openCount", { n: open }) : t("marketing.statusFull")}
                  </p>}
                </li>
              );
            })}
          </ul>
        </div>
      </section>}

      <section id="society-work" className="border-b border-border/70 py-24 sm:py-32">
        <div className="section-shell grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div>
            <p className="eyebrow">The society</p>
            <h2 className="mt-5 max-w-[12ch] font-display text-[clamp(2.75rem,5vw,5rem)] font-normal leading-[1.03] tracking-[-0.015em]">
              {t("marketing.activitiesTitle")}
            </h2>
          </div>
          <ol className="border-t border-foreground/20">
            {ACTIVITIES.filter((a) => a.href !== "/blog" || sections.dispatch).map((a, index) => (
              <li key={a.title} className="grid gap-4 border-b border-foreground/20 py-7 sm:grid-cols-[3rem_1fr] sm:py-9">
                <span className="pt-1 font-mono text-sm font-semibold text-primary">0{index + 1}</span>
                <div>
                  <h3 className="font-display text-3xl font-normal leading-tight">
                    {a.href ? <Link href={a.href} className="hover:text-primary">{t(a.title)} ↗</Link> : t(a.title)}
                  </h3>
                  <p className="mt-2 max-w-xl text-base leading-relaxed text-muted-foreground">{t(a.body)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <ConferenceCarousel />

      {sections.activeEvent && content.awards.length > 0 && (
        <section className="border-b border-border/70 py-16 sm:py-20">
          <div className="section-shell">
            <h2 className="text-2xl font-semibold sm:text-3xl">{t("marketing.awardsTitle")}</h2>
            <ul className="mt-6 flex flex-wrap gap-3">
              {content.awards.map((award) => (
                <li key={award} className="rounded-full border border-border px-4 py-2 text-base">{award}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {content.queryContacts.length > 0 && (
        <section className="py-16 sm:py-20">
          <div className="section-shell">
            <h2 className="text-2xl font-semibold sm:text-3xl">{t("marketing.contactsTitle")}</h2>
            <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {content.queryContacts.map((contact) => (
                <li key={contact.phone}>
                  <p className="font-semibold">{contact.name}</p>
                  <p className="text-sm text-muted-foreground">{contact.role}</p>
                  <a href={"tel:" + contact.phone} className="mt-1 inline-block font-mono text-sm tabular-nums text-primary hover:underline">
                    {contact.phone}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
