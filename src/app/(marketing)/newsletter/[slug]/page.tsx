import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, FileDown, ScanSearch } from "lucide-react";
import { ISSUE, getArticle } from "@/content/newsletter/issue-01";
import { t } from "@/content/strings";
import { Blocks } from "../_components/blocks";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = getArticle((await params).slug);
  if (!found) return { title: "Not Found" };
  const { article } = found;
  return {
    title: `${article.headline} · ${ISSUE.title}`,
    description: article.dek,
    openGraph: {
      type: "article",
      title: article.headline,
      description: article.dek,
      images: [{ url: ISSUE.pageImage(article.page), width: 1588, height: 2246 }],
    },
  };
}

export default async function NewsletterArticlePage({ params }: Props) {
  const found = getArticle((await params).slug);
  if (!found) notFound();
  const { article, prev, next } = found;

  return (
    <article className="mx-auto max-w-[72rem] px-4 pb-16 pt-8 sm:px-8 lg:pt-12">
      <Link href="/newsletter" className="nl-serif inline-flex items-center gap-2 text-sm font-bold hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        {t("newsletter.backToIssue")}
      </Link>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="nl-serif bg-[var(--nl-red)] px-3 py-1 text-base font-bold uppercase tracking-wide text-white sm:text-lg">
            EXPLAINED
          </p>
          <p className="nl-serif text-base font-bold uppercase sm:text-lg">
            <span aria-hidden className="mr-1">|</span>
            {article.desk}
          </p>
          <p className="nl-serif w-full text-base sm:ml-auto sm:w-auto sm:text-lg">{article.date}</p>
        </div>
        <div className="nl-double-rule mt-3" aria-hidden />
        {article.kicker && (
          <p className="nl-serif nl-red mt-5 text-sm font-bold uppercase tracking-wide">{article.kicker}</p>
        )}
        <h1 className="nl-serif mt-3 text-[2.25rem] font-bold leading-[1.05] tracking-[-0.01em] sm:text-5xl lg:text-[3.75rem]">
          {article.headline}
        </h1>
        <p className="nl-serif mt-4 text-xl italic leading-snug sm:text-2xl">{article.dek}</p>
      </header>

      <Blocks blocks={article.blocks} />

      <footer className="mt-8 border-t-2 border-[var(--nl-ink)]/60 pt-4 sm:flex sm:items-baseline sm:justify-between sm:gap-6">
        <p className="nl-serif text-base font-bold">{article.byline}</p>
        <p className="nl-serif mt-2 text-sm sm:mt-0 sm:text-right">{article.sources}</p>
      </footer>

      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href={ISSUE.pageImage(article.page)}
          target="_blank"
          rel="noopener"
          className="nl-serif inline-flex items-center gap-2 border-2 border-[var(--nl-ink)] px-4 py-2 font-bold hover:bg-[var(--nl-ink)] hover:text-[var(--nl-paper)]"
        >
          <ScanSearch className="size-4" aria-hidden />
          {t("newsletter.originalPage")} · {t("newsletter.page", { n: article.page })}
        </a>
        <a
          href={ISSUE.pdf}
          download
          className="nl-serif inline-flex items-center gap-2 border-2 border-[var(--nl-ink)] px-4 py-2 font-bold hover:bg-[var(--nl-ink)] hover:text-[var(--nl-paper)]"
        >
          <FileDown className="size-4" aria-hidden />
          {t("newsletter.downloadPdf")}
        </a>
      </div>

      <div className="nl-thin-double mt-10" aria-hidden />
      <nav aria-label={t("newsletter.contents")} className="mt-4 grid gap-4 sm:grid-cols-2">
        {prev ? (
          <Link href={`/newsletter/${prev.slug}`} className="group block">
            <span className="nl-serif nl-red inline-flex items-center gap-1 text-sm font-bold uppercase">
              <ArrowLeft className="size-4" aria-hidden />
              {t("newsletter.previous")}
            </span>
            <span className="nl-serif mt-1 block text-xl font-bold leading-snug group-hover:underline">{prev.headline}</span>
          </Link>
        ) : (
          <span />
        )}
        <Link href={next ? `/newsletter/${next.slug}` : "/newsletter#note"} className="group block sm:text-right">
          <span className="nl-serif nl-red inline-flex items-center gap-1 text-sm font-bold uppercase">
            {next ? t("newsletter.next") : t("newsletter.backToIssue")}
            <ArrowRight className="size-4" aria-hidden />
          </span>
          {next && (
            <span className="nl-serif mt-1 block text-xl font-bold leading-snug group-hover:underline">{next.headline}</span>
          )}
        </Link>
      </nav>
    </article>
  );
}
