import { formatDateLong } from "@/lib/datetime"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
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
    title: `${post.title} · The Dispatch`,
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
      <header className="mx-auto max-w-[760px] px-4 pb-10 pt-8 sm:px-6 sm:pt-10">
        <Link href="/blog" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
          {t("marketing.allDispatches")}
        </Link>
        <h1 className="headline mt-8">{post.title}</h1>
        {post.subtitle && <p className="mt-4 max-w-3xl text-xl leading-relaxed text-muted-foreground">{post.subtitle}</p>}
        <p className="mt-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{post.author.name ?? t("marketing.anonymousAuthor")}</span>
          {post.publishedAt && <> · <time dateTime={post.publishedAt.toISOString()}>{formatDateLong(post.publishedAt)}</time></>}
          {post.readMin && <> · {t("blog.readMin", { n: post.readMin })}</>}
        </p>
      </header>

      {post.coverImage && (
        <div className="section-shell">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.coverImage}
            alt={post.title}
            className="max-h-[680px] w-full rounded-lg object-cover"
          />
        </div>
      )}

      <article className="mx-auto max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
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
