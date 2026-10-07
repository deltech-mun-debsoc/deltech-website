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
    <div className="section-shell py-12 sm:py-16">
      <h1 className="headline">{t("marketing.dispatchTitle")}</h1>
      {posts.length === 0 ? (
        <div className="mt-10 max-w-xl">
          <p className="text-lg text-muted-foreground">{t("marketing.dispatchEmpty")}</p>
          <Link href="/signin?callbackUrl=/write" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>{t("marketing.dispatchEmptyCta")}</Link>
        </div>
      ) : (
        <>
          <Link href={`/blog/${featured.slug}`} className={cn("group mt-10 grid gap-6 border-b border-border pb-12", featured.coverImage && "lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-10")}>
            {featured.coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={featured.coverImage} alt="" className="aspect-[3/2] w-full rounded-lg bg-muted object-cover" />
            )}
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold leading-snug group-hover:underline sm:text-3xl">{featured.title}</h2>
              {featured.subtitle && <p className="mt-3 line-clamp-3 text-lg leading-relaxed text-muted-foreground">{featured.subtitle}</p>}
              <p className="mt-4 text-sm text-muted-foreground">{metaLine(featured)}</p>
            </div>
          </Link>

          {rest.length > 0 && (
            <ul className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((post) => (
                <li key={post.id}>
                  <Link href={`/blog/${post.slug}`} className="group block">
                    {post.coverImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={post.coverImage} alt="" loading="lazy" className="mb-4 aspect-[3/2] w-full rounded-lg bg-muted object-cover" />
                    )}
                    <h2 className="text-lg font-semibold leading-snug group-hover:underline">{post.title}</h2>
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
  )
}
