import { formatDateLong } from "@/lib/datetime"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Clock, ChevronLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/prisma"
import { TiptapContent } from "@/lib/tiptap-renderer"
import { STRINGS, t } from "@/content/strings"

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await prisma.post.findUnique({
    where: { slug, status: "PUBLISHED" },
    select: { title: true, subtitle: true, coverImage: true },
  })
  if (!post) return { title: "Not Found" }
  return {
    title: `${post.title} · ${STRINGS.brand.name} Blog`,
    description: post.subtitle ?? undefined,
    openGraph: post.coverImage ? { images: [{ url: post.coverImage }] } : undefined,
  }
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params

  const post = await prisma.post.findUnique({
    where: { slug, status: "PUBLISHED" },
    select: {
      title: true,
      subtitle: true,
      coverImage: true,
      contentJson: true,
      readMin: true,
      tags: true,
      publishedAt: true,
      author: { select: { name: true } },
    },
  })

  if (!post) notFound()

  return (
    <div className="min-h-screen bg-background">
      <div className="section-shell pt-10">
        <Link
          href="/blog"
          className="ink-link inline-flex items-center gap-2 text-sm font-semibold"
        >
          <ChevronLeft className="size-4" />
          {t("marketing.allDispatches")}
        </Link>
      </div>

      <header className="section-shell grid gap-10 border-b border-foreground/20 py-14 lg:grid-cols-[1fr_0.38fr] lg:items-end lg:py-20">
        <div>
          {post.tags.length > 0 && <p className="eyebrow">{post.tags.slice(0, 3).join(" · ")}</p>}
          <h1 className="display-section mt-5 max-w-[12ch]">{post.title}</h1>
          {post.subtitle && <p className="body-large mt-7 max-w-3xl text-muted-foreground">{post.subtitle}</p>}
        </div>
        <div className="border-l border-foreground/20 pl-6 text-sm leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">{post.author.name ?? t("marketing.anonymousAuthor")}</p>
          {post.publishedAt && (
            <time className="mt-2 block" dateTime={post.publishedAt.toISOString()}>
              {formatDateLong(post.publishedAt)}
            </time>
          )}
          {post.readMin && <p className="mt-2 flex items-center gap-2"><Clock className="size-4" /> {t("blog.readMin", { n: post.readMin })}</p>}
        </div>
      </header>

      {post.coverImage && (
        <div className="section-shell mt-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.coverImage}
            alt={post.title}
            className="max-h-[680px] w-full border border-foreground/15 object-cover"
          />
        </div>
      )}

      <article className="mx-auto max-w-[760px] px-6 py-14 sm:py-20">
        <TiptapContent json={post.contentJson} className="blog-prose" />
        {post.tags.length > 0 && (
          <div className="mt-14 flex flex-wrap gap-2 border-t border-border pt-7">
            {post.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
          </div>
        )}
      </article>
    </div>
  )
}
