import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, FileDown, ScanSearch } from "lucide-react";
import { ARTICLES, ISSUE } from "@/content/newsletter/issue-01";
import { t } from "@/content/strings";

export const metadata: Metadata = {
  title: t("newsletter.metaTitle"),
  description: t("newsletter.metaDescription"),
  openGraph: {
    title: t("newsletter.metaTitle"),
    description: t("newsletter.metaDescription"),
    images: [{ url: ISSUE.cover.page, width: 1588, height: 2246 }],
  },
};

const BUTTON =
  "nl-serif inline-flex items-center gap-2 border-2 border-[var(--nl-ink)] px-4 py-2 font-bold hover:bg-[var(--nl-ink)] hover:text-[var(--nl-paper)]";

function Rule() {
  return <span className="h-px flex-1 bg-[var(--nl-ink)]" aria-hidden />;
}

export default function NewsletterIssuePage() {
  const { masthead, cover, note } = ISSUE;
  return (
    <div className="mx-auto max-w-[60rem] px-4 pb-20 pt-8 sm:px-8 lg:pt-12">
      <section aria-labelledby="masthead" className="text-center">
        <div className="flex items-center gap-4">
          <span className="nl-thin-double flex-1" aria-hidden />
          <span className="nl-blackletter text-3xl leading-none sm:text-4xl">{masthead.the}</span>
          <span className="nl-thin-double flex-1" aria-hidden />
        </div>
        <h1
          id="masthead"
          className="nl-masthead mt-1 text-[2.6rem] leading-none tracking-[0.01em] [text-shadow:2px_2px_0_rgb(0_0_0/0.18)] sm:text-7xl lg:text-[5.5rem]"
        >
          {masthead.name}
        </h1>
        <div className="nl-thin-double mt-4" aria-hidden />
        <p className="nl-serif mt-4 text-[0.8rem] font-bold tracking-[0.1em] sm:text-xl">{masthead.tagline}</p>
        <div className="mt-3 flex items-center gap-3 sm:gap-5">
          <Rule />
          <p className="nl-serif text-[0.65rem] font-bold tracking-[0.18em] sm:text-sm">
            {masthead.meta.join("  |  ")}
          </p>
          <Rule />
        </div>

        <Image
          src={cover.cartoons}
          width={cover.cartoonsWidth}
          height={cover.cartoonsHeight}
          alt={cover.cartoonsAlt}
          sizes="(min-width: 960px) 880px, 100vw"
          priority
          className="mt-7 h-auto w-full"
        />

        <div className="nl-thin-double mt-7" aria-hidden />
        <p className="nl-serif mt-2 flex items-center justify-center gap-5 bg-[var(--nl-band)] px-4 py-4 text-[1.3rem] font-bold italic text-[#f3f1ec] sm:text-4xl">
          <span aria-hidden className="text-xl not-italic">✦</span>
          {masthead.banner}
        </p>
        <div className="nl-thin-double mt-2" aria-hidden />

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href={ISSUE.pdf} download className={BUTTON}>
            <FileDown className="size-4" aria-hidden />
            {t("newsletter.downloadPdf")}
          </a>
          <a href={cover.page} target="_blank" rel="noopener" className={BUTTON}>
            <ScanSearch className="size-4" aria-hidden />
            {t("newsletter.originalPage")}
          </a>
        </div>
      </section>

      <section aria-labelledby="contents" className="mt-16">
        <div className="flex items-center gap-4">
          <h2 id="contents" className="nl-serif nl-red shrink-0 text-sm font-bold uppercase tracking-[0.08em]">
            {t("newsletter.contents")}
          </h2>
          <Rule />
        </div>
        <ol className="mt-2">
          {ARTICLES.map((article) => (
            <li key={article.slug} className="border-b border-[var(--nl-ink)]/40">
              <Link
                href={`/newsletter/${article.slug}`}
                className="group grid gap-2 py-6 sm:grid-cols-[5.5rem_1fr_auto] sm:items-start sm:gap-6"
              >
                <span className="nl-serif nl-red text-sm font-bold uppercase">
                  {t("newsletter.page", { n: article.page })}
                </span>
                <span>
                  <span className="nl-serif block text-sm font-bold uppercase tracking-wide">{article.desk}</span>
                  <span className="nl-serif mt-1 block text-2xl font-bold leading-tight group-hover:underline sm:text-3xl">
                    {article.headline}
                  </span>
                  <span className="nl-serif mt-2 block text-lg italic leading-snug">{article.dek}</span>
                </span>
                <span className="nl-serif inline-flex items-center gap-1 text-sm font-bold sm:mt-1">
                  {t("newsletter.readArticle")}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section id="note" aria-labelledby="note-title" className="mt-20 scroll-mt-28">
        <p className="text-[0.7rem] font-medium uppercase">{note.label}</p>
        <div className="mt-1 border-t-[3px] border-double border-[var(--nl-ink)]" aria-hidden />
        <div className="border-t border-dotted border-[var(--nl-ink)]" aria-hidden />
        <h2
          id="note-title"
          className="nl-anton mt-8 text-balance text-center text-[2.9rem] uppercase leading-[0.95] sm:text-7xl lg:text-[5.25rem]"
        >
          {note.title}
        </h2>
        <div className="mt-6 flex items-center gap-6">
          <span className="h-0.5 flex-1 bg-[var(--nl-ink)]/70" aria-hidden />
          <Image src={note.logo} width={220} height={230} alt={note.logoAlt} className="h-24 w-auto" />
          <span className="h-0.5 flex-1 bg-[var(--nl-ink)]/70" aria-hidden />
        </div>
        <p className="nl-body mt-2 text-center text-2xl italic tracking-wide">{note.subtitle}</p>

        <div className="nl-body mt-10 space-y-5 text-[1.0625rem] italic leading-relaxed sm:text-lg">
          <p className="font-bold">{note.salutation}</p>
          {note.paragraphs.map((para) => (
            <p key={para} className="lg:text-justify">
              {para.split("\n").map((line, i) => (
                <span key={i} className={i > 0 ? "block" : undefined}>
                  {line}
                </span>
              ))}
            </p>
          ))}
          <p className="pt-4">
            {note.signoff.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        </div>
        <div className="nl-double-rule mt-12" aria-hidden />
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={ISSUE.pageImage(note.page)} target="_blank" rel="noopener" className={BUTTON}>
            <ScanSearch className="size-4" aria-hidden />
            {t("newsletter.originalPage")} · {t("newsletter.page", { n: note.page })}
          </a>
        </div>
      </section>
    </div>
  );
}
