import Link from "next/link";
import { t } from "@/content/strings";
import { DOCS_URL } from "@/lib/app-url";
import type { Content } from "@/content/contentSchema";
import { BrandLogo } from "@/components/brand-logo";

type Props = {
  contacts: Content["queryContacts"];
  conferenceDates: string;
  venue: string;
  societyLocation: string;
  societyEmail: string;
  sections: Content["publicSections"];
  activeEventName: string;
  registrationOpen: boolean;
  showActiveEvent: boolean;
};

export function Footer({ contacts, conferenceDates, venue, societyLocation, societyEmail, sections, activeEventName, registrationOpen, showActiveEvent }: Props) {
  return (
    <footer className="mt-auto border-t border-border/70 bg-ink text-paper">
      <div className="section-shell py-12 sm:py-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-[1.4fr_0.7fr_0.8fr_1fr] lg:gap-12">
          <div className="col-span-2 lg:col-span-1">
            <BrandLogo tone="white" className="w-24" />
            <p className="mt-6 max-w-sm text-base leading-relaxed text-paper/70">
              {t("brand.tagline")}
            </p>
          </div>

          <nav aria-label={t("nav.home")}>
            <p className="data-label mb-5 text-gold-300">{t("marketing.footerExplore")}</p>
            <ul className="space-y-3 text-[0.9375rem]">
              <li>
                <Link href="/" className="text-paper/70 transition-colors hover:text-paper">
                  {t("nav.home")}
                </Link>
              </li>
              {sections.matrix && <li>
                <Link href="/availability" className="text-paper/70 transition-colors hover:text-paper">
                  {t("nav.availability")}
                </Link>
              </li>}
              {sections.team && <li>
                <Link href="/team" className="text-paper/70 transition-colors hover:text-paper">
                  {t("marketing.teamLabel")}
                </Link>
              </li>}
              {sections.dispatch && <li>
                <Link href="/blog" className="text-paper/70 transition-colors hover:text-paper">
                  {t("nav.blog")}
                </Link>
              </li>}
              <li>
                <a href={DOCS_URL} className="text-paper/70 transition-colors hover:text-paper">
                  {t("nav.docs")}
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <p className="data-label mb-5 text-gold-300">{t("marketing.footerOperations")}</p>
            <ul className="space-y-3 text-[0.9375rem]">
              {sections.registration && <li>
                <Link href={registrationOpen ? "/register" : "/register/closed"} className="text-paper/70 transition-colors hover:text-paper">
                  {registrationOpen ? t("nav.register") : t("marketing.registrationStatus")}
                </Link>
              </li>}
              {sections.quiz && <li>
                <Link href="/quiz/join" className="text-paper/70 transition-colors hover:text-paper">
                  {t("nav.quizJoin")}
                </Link>
              </li>}
              <li>
                <Link href="/signin" className="text-paper/70 transition-colors hover:text-paper">
                  {t("marketing.organiserSignIn")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="col-span-2 lg:col-span-1">
            <p className="data-label mb-5 text-gold-300">{showActiveEvent ? activeEventName || t("marketing.footerBrief") : t("marketing.societyContact")}</p>
            {showActiveEvent && <>
            <p className="text-[0.9375rem] text-paper/70">
              {conferenceDates || t("marketing.datesPending")}
            </p>
            <p className="mt-1 text-[0.9375rem] text-paper/70">
              {venue || t("marketing.venuePending")}
            </p>
            </>}
            {showActiveEvent && <p className="data-label mt-6 border-t border-paper/15 pt-5 text-gold-300">{t("marketing.societyContact")}</p>}
            <address className="mt-3 not-italic text-[0.9375rem] text-paper/70">
              <p>{societyLocation}</p>
              <a className="mt-1 inline-block hover:text-gold-300" href={`mailto:${societyEmail}`}>
                {societyEmail}
              </a>
            </address>
            {contacts.length > 0 && (
              <ul className="mt-5 space-y-4 text-[0.9375rem]">
                {contacts.map((contact) => (
                  <li key={contact.phone}>
                    <p className="font-semibold text-paper">{contact.name}</p>
                    <a
                      href={"tel:" + contact.phone}
                      className="font-mono text-sm tabular-nums text-paper/60 hover:text-gold-300"
                    >
                      {contact.phone}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-paper/15 pt-6 text-sm text-paper/60 lg:mt-14">
          <span>{t("brand.name")}</span>
          <span>{t("marketing.footerLocation")}</span>
        </div>
      </div>
    </footer>
  );
}
