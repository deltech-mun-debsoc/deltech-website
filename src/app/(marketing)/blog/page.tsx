import { formatDate } from "@/lib/datetime"
import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { STRINGS, t } from "@/content/strings"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
            <h1 className="display-hero mt-6">{t("marketing.dispatchTitle")}</h1>
          </div>
          <p className="body-large text-muted-foreground">{t("marketing.dispatchBody")}</p>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="section-shell">
          {posts.length === 0 ? (
            <div className="border-y border-border py-16">
              <h2 className="display-section">{t("marketing.dispatchEmpty")}</h2>
              <p className="body-large mt-5 max-w-2xl text-muted-foreground">{t("marketing.dispatchEmptyBody")}</p>
              <Link href="/signin/staff?callbackUrl=/write" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-8")}>{t("marketing.dispatchEmptyCta")}</Link>
            </div>
          ) : (
            <div>
              {/* The story leads. With a cover it sits beside the title; without
                  one the title takes the full width rather than a filler block. */}
              <Link href={`/blog/${featured.slug}`} className={cn("group grid gap-8 border-b border-foreground/20 pb-16", featured.coverImage && "lg:grid-cols-[1.08fr_0.92fr] lg:items-center")}>
                {featured.coverImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={featured.coverImage} alt={featured.title} className="aspect-[4/3] w-full border border-foreground/15 object-cover" />
                )}
                <div className={featured.coverImage ? "lg:pl-6" : "max-w-5xl"}>
                  <p className="eyebrow">{t("marketing.latestDispatch")}</p>
                  <h2 className={cn("display-section mt-5 transition-colors group-hover:text-primary", !featured.coverImage && "max-w-[18ch] sm:text-[clamp(3rem,6.5vw,6rem)]")}>{featured.title}</h2>
                  {featured.subtitle && <p className="body-large mt-6 line-clamp-3 max-w-3xl text-muted-foreground">{featured.subtitle}</p>}
                  <p className="mt-7 text-sm text-muted-foreground">{metaLine(featured)}</p>
                  <span className="mt-8 inline-flex items-center gap-2 font-semibold text-primary">
                    {t("marketing.readArticle")} <ArrowRight className="size-4" />
                  </span>
                </div>
              </Link>

              <div>
                {rest.map((post) => (
                  <Link key={post.id} href={`/blog/${post.slug}`} className="group grid gap-5 border-b border-foreground/20 py-9 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <h2 className="font-heading text-3xl leading-tight transition-colors group-hover:text-primary md:text-4xl">{post.title}</h2>
                      {post.subtitle && <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">{post.subtitle}</p>}
                      <p className="mt-4 text-sm text-muted-foreground">{metaLine(post)}</p>
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
