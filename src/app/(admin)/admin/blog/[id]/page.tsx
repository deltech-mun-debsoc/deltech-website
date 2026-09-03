import { formatDate } from "@/lib/datetime"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, CalendarDays, Clock, Tag } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/prisma"
import { TiptapContent } from "@/lib/tiptap-renderer"
import { ModerationPanel } from "./_components/moderation-panel"
import { DeletePostButton } from "./_components/delete-post-button"
import { requireStaff } from "@/lib/authz"
import { STATUS_BADGE } from "../_lib/status-badge"

export default async function AdminBlogPostPage(props: { params: Promise<{ id: string }> }) {
  // deletePost is requireAdmin, so a MAINTAINER must not be shown a button that
  // would only refuse them. Read access to this page stays staff-wide.
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const { id } = await props.params

  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      subtitle: true,
      coverImage: true,
      contentJson: true,
      status: true,
      readMin: true,
      tags: true,
      reviewNote: true,
      submittedAt: true,
      publishedAt: true,
      author: { select: { name: true, email: true } },
    },
  })

  if (!post) notFound()

  const status = post.status as keyof typeof STATUS_BADGE

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/admin/blog"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Back
        </Link>
        <span className="text-border">·</span>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status] ?? STATUS_BADGE.DRAFT}`}>
          {status.replace("_", " ")}
        </span>
      </div>

      <div className="flex gap-8">
        {/* Article preview */}
        <article className="min-w-0 flex-1 rounded-xl border bg-card">
          {post.coverImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.coverImage}
              alt="Cover"
              className="h-64 w-full rounded-t-xl object-cover"
            />
          )}

          <div className="px-10 py-10">
            <h1 className="font-serif text-3xl font-bold leading-tight text-card-foreground">
              {post.title || <span className="italic text-muted-foreground">Untitled</span>}
            </h1>

            {post.subtitle && (
              <p className="mt-3 font-serif text-xl leading-relaxed text-muted-foreground">
                {post.subtitle}
              </p>
            )}

            <div className="mt-6 mb-8 border-t border-border/70" />

            <TiptapContent json={post.contentJson} className="blog-prose" />

            {post.tags.length > 0 && (
              <div className="mt-12 flex flex-wrap gap-2 border-t border-border/70 pt-6">
                {post.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </article>

        {/* Metadata + actions sidebar */}
        <aside className="w-64 shrink-0 space-y-5">
          {/* Author */}
          <div className="rounded-xl border bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Author</p>
            <p className="text-sm font-medium">{post.author.name ?? "-"}</p>
            <p className="text-xs text-muted-foreground">{post.author.email}</p>
          </div>

          {/* Metadata */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Details</p>

            {post.submittedAt && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" />
                Submitted {formatDate(post.submittedAt)}
              </div>
            )}

            {post.publishedAt && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" />
                Published {formatDate(post.publishedAt)}
              </div>
            )}

            {post.readMin && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="size-3.5 shrink-0" />
                {post.readMin} min read
              </div>
            )}

            {post.tags.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Tag className="size-3.5 mt-0.5 shrink-0" />
                <span className="text-xs">{post.tags.join(", ")}</span>
              </div>
            )}
          </div>

          {/* Review note (if any) */}
          {post.reviewNote && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1 dark:border-amber-800 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide dark:text-amber-300">Review note</p>
              <p className="text-sm text-amber-900 leading-relaxed dark:text-amber-100">{post.reviewNote}</p>
            </div>
          )}

          {/* Moderation actions */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Moderation</p>
            <ModerationPanel
              postId={post.id}
              status={post.status as "PENDING" | "PUBLISHED" | "CHANGES_REQUESTED" | "REJECTED" | "DRAFT"}
            />
            {/* Outside ModerationPanel on purpose: that renders a bare status
                badge for anything already decided, so a delete nested in it
                would be missing from every published post. */}
            {isAdmin && <DeletePostButton postId={post.id} title={post.title} />}
          </div>
        </aside>
      </div>
    </div>
  )
}
