import { formatDate } from "@/lib/datetime"
import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { STRINGS, t } from "@/content/strings"

export const metadata: Metadata = {
  title: `Blog · ${STRINGS.brand.name}`,
  description: `Stories, insights, and updates from the ${STRINGS.brand.name} community.`,
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

function PlaceholderCover({ className }: { className?: string }) {
  return (
    <div className={`noise-wash relative overflow-hidden border border-foreground/15 ${className ?? ""}`}>
      <span className="absolute -bottom-8 right-4 display text-[9rem] leading-none text-gold-700/35" aria-hidden>D</span>
      <span className="data-label absolute left-5 top-5 text-muted-foreground">{t("marketing.dispatchMark")}</span>
    </div>
  )
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
      <section className="border-b border-border/70 py-20 sm:py-28">
        <div className="section-shell grid gap-10 lg:grid-cols-[1fr_0.55fr] lg:items-end">
          <div>
            <p className="eyebrow">{t("marketing.dispatchEyebrow")}</p>
            <h1 className="display-section mt-6">{t("marketing.dispatchTitle")}</h1>
          </div>
          <p className="body-large text-muted-foreground">{t("marketing.dispatchBody")}</p>
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className="section-shell">
          {posts.length === 0 ? (
            <div className="noise-wash grid min-h-80 place-items-center border-y border-border px-6 text-center">
              <div>
                <p className="display text-7xl text-gold-700/45" aria-hidden>D</p>
                <p className="mt-5 font-heading text-3xl">{t("marketing.dispatchEmpty")}</p>
                <p className="mt-3 text-base text-muted-foreground">{t("marketing.dispatchEmptyBody")}</p>
              </div>
            </div>
          ) : (
            <div>
              <Link href={`/blog/${featured.slug}`} className="group grid gap-8 border-b border-foreground/20 pb-16 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
                {featured.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={featured.coverImage} alt={featured.title} className="aspect-[4/3] w-full border border-foreground/15 object-cover grayscale transition duration-500 group-hover:grayscale-0" />
                ) : (
                  <PlaceholderCover className="aspect-[4/3] w-full" />
                )}
                <div className="lg:pl-6">
                  <p className="eyebrow">{t("marketing.latestDispatch")}</p>
                  <h2 className="mt-5 font-heading text-5xl leading-[0.98] transition-colors group-hover:text-primary sm:text-6xl">{featured.title}</h2>
                  {featured.subtitle && <p className="body-large mt-6 line-clamp-3 text-muted-foreground">{featured.subtitle}</p>}
                  <p className="data-label mt-7 text-muted-foreground">{metaLine(featured)}</p>
                  <span className="mt-8 inline-flex items-center gap-2 font-semibold text-primary">
                    {t("marketing.readDispatch")} <ArrowRight className="size-4" />
                  </span>
                </div>
              </Link>

              <div>
                {rest.map((post, index) => (
                  <Link key={post.id} href={`/blog/${post.slug}`} className="group grid gap-5 border-b border-foreground/20 py-9 sm:grid-cols-[4rem_1fr_auto] sm:items-center">
                    <span className="font-mono text-sm font-semibold text-primary">{String(index + 2).padStart(2, "0")}</span>
                    <div>
                      <h2 className="font-heading text-3xl leading-tight transition-colors group-hover:text-primary md:text-4xl">{post.title}</h2>
                      {post.subtitle && <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">{post.subtitle}</p>}
                      <p className="data-label mt-4 text-muted-foreground">{metaLine(post)}</p>
                    </div>
                    <ArrowRight className="size-6 transition-transform group-hover:translate-x-1" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
