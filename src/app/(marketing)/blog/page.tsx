import { formatDate } from "@/lib/datetime"
import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { STRINGS, t } from "@/content/strings"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: `The Dispatch · ${STRINGS.brand.name}`,
  description: `Articles by ${STRINGS.brand.name} delegates, chairs and organisers.`,
}

function metaLine(post: { author: { name: string | null }; publishedAt: Date | null; readMin: number | null }) {
  const parts = [
    post.author.name ?? t("marketing.anonymousAuthor"),
    post.publishedAt
      ? formatDate(post.publishedAt)
      : null,
    post.readMin ? t("blog.readMin", { n: post.readMin }) : null,
  ].filter(Boolean)
  return parts.join(" · ")
}

export default async function BlogIndexPage() {
  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      title: true,
      subtitle: true,
      slug: true,
      coverImage: true,
      readMin: true,
      tags: true,
      publishedAt: true,
      author: { select: { name: true } },
    },
  })

  const [featured, ...rest] = posts

  return (
    <div>
      <header className="relative overflow-hidden border-b border-border/70 py-20 sm:py-28">
        <div className="paper-grid absolute inset-0 opacity-60" aria-hidden />
        <div className="section-shell relative">
          <p className="eyebrow">DelTech MUN</p>
          <h1 className="mt-5 font-display text-[clamp(3.75rem,8vw,8rem)] font-normal leading-none tracking-[-0.025em]">{t("marketing.dispatchTitle")}</h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">Articles by delegates, chairs and organisers.</p>
        </div>
      </header>
      <div className="section-shell py-16 sm:py-24">
      {posts.length === 0 ? (
        <div className="max-w-xl border-t border-border pt-8">
          <p className="text-lg text-muted-foreground">{t("marketing.dispatchEmpty")}</p>
          <Link href="/signin?callbackUrl=/write" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>{t("marketing.dispatchEmptyCta")}</Link>
        </div>
      ) : (
        <>
          <Link href={`/blog/${featured.slug}`} className={cn("group grid overflow-hidden border border-foreground/20 bg-ink text-paper", featured.coverImage && "lg:grid-cols-[1.15fr_1fr] lg:items-stretch")}>
            {featured.coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={featured.coverImage} alt="" className="aspect-[3/2] h-full w-full object-cover" />
            )}
            <div className="flex min-h-72 max-w-2xl flex-col justify-between gap-10 p-8 sm:p-12">
              <span className="text-sm font-semibold text-gold-300">Featured article</span>
              <div>
                <h2 className="font-display text-[clamp(2.25rem,4vw,4.5rem)] font-normal leading-[1.04] group-hover:underline">{featured.title}</h2>
                {featured.subtitle && <p className="mt-4 line-clamp-3 text-lg leading-relaxed text-paper/75">{featured.subtitle}</p>}
                <p className="mt-6 text-sm text-paper/60">{metaLine(featured)}</p>
              </div>
            </div>
          </Link>

          {rest.length > 0 && (
            <ul className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((post) => (
                <li key={post.id}>
                  <Link href={`/blog/${post.slug}`} className="group block">
                    {post.coverImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.coverImage} alt="" loading="lazy" className="mb-4 aspect-[3/2] w-full bg-muted object-cover" />
                    )}
                    <h2 className="font-display text-2xl font-normal leading-snug group-hover:underline">{post.title}</h2>
                    {post.subtitle && <p className="mt-2 line-clamp-2 text-base leading-relaxed text-muted-foreground">{post.subtitle}</p>}
                    <p className="mt-3 text-sm text-muted-foreground">{metaLine(post)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      </div>
    </div>
  )
}
