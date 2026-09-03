import Link from "next/link";
import { t } from "@/content/strings";
import type { Content } from "@/content/contentSchema";

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
      <div className="section-shell py-16 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_0.7fr_0.8fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="display flex size-12 items-center justify-center rounded-full border border-paper/30 text-2xl">
                D
              </span>
              <p className="display text-3xl">{t("brand.name")}</p>
            </div>
            <p className="mt-5 max-w-sm text-base leading-relaxed text-paper/68">
              {t("brand.tagline")}
            </p>
            <p className="data-label mt-8 text-paper/45">{t("marketing.footerSignal")}</p>
          </div>

          <nav aria-label={t("nav.home")}>
            <p className="data-label mb-5 text-gold-300">{t("marketing.footerExplore")}</p>
            <ul className="space-y-3 text-[0.9375rem]">
              <li>
                <Link href="/" className="text-paper/68 transition-colors hover:text-paper">
                  {t("nav.home")}
                </Link>
              </li>
              {sections.matrix && <li>
                <Link href="/availability" className="text-paper/68 transition-colors hover:text-paper">
                  {t("nav.availability")}
                </Link>
              </li>}
              {sections.team && <li>
                <Link href="/team" className="text-paper/68 transition-colors hover:text-paper">
                  {t("marketing.teamLabel")}
                </Link>
              </li>}
              {sections.dispatch && <li>
                <Link href="/blog" className="text-paper/68 transition-colors hover:text-paper">
                  {t("nav.blog")}
                </Link>
              </li>}
            </ul>
          </nav>

          <div>
            <p className="data-label mb-5 text-gold-300">{t("marketing.footerOperations")}</p>
            <ul className="space-y-3 text-[0.9375rem]">
              {sections.registration && <li>
                <Link href={registrationOpen ? "/register" : "/register/closed"} className="text-paper/68 transition-colors hover:text-paper">
                  {registrationOpen ? t("nav.register") : "Registration status"}
                </Link>
              </li>}
              {sections.quiz && <li>
                <Link href="/quiz/join" className="text-paper/68 transition-colors hover:text-paper">
                  {t("nav.quizJoin")}
                </Link>
              </li>}
              <li>
                <Link href="/signin/staff" className="text-paper/68 transition-colors hover:text-paper">
                  {t("marketing.organiserSignIn")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="data-label mb-5 text-gold-300">{showActiveEvent ? activeEventName || t("marketing.footerBrief") : "Society contact"}</p>
            {showActiveEvent && <>
            <p className="text-[0.9375rem] text-paper/68">
              {conferenceDates || t("marketing.datesPending")}
            </p>
            <p className="mt-1 text-[0.9375rem] text-paper/68">
              {venue || t("marketing.venuePending")}
            </p>
            </>}
            {showActiveEvent && <p className="data-label mt-6 border-t border-paper/15 pt-5 text-gold-300">Society contact</p>}
            <address className="mt-3 not-italic text-[0.9375rem] text-paper/68">
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

        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-paper/15 pt-6 text-sm text-paper/45">
          <span>{t("brand.name")}</span>
          <span>{t("marketing.footerLocation")}</span>
        </div>
      </div>
    </footer>
  );
}
