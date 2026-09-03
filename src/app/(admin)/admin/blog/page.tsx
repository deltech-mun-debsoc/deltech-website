import { formatDayMonth } from "@/lib/datetime"
import Link from "next/link"
import { Clock, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { prisma } from "@/lib/prisma"
import { PageHeader } from "@/app/(admin)/_components/page-header"
import { STATUS_BADGE } from "./_lib/status-badge"

export default async function AdminBlogPage() {
  const [pending, recent] = await Promise.all([
    prisma.post.findMany({
      where: { status: { in: ["PENDING", "CHANGES_REQUESTED"] } },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        readMin: true,
        submittedAt: true,
        author: { select: { name: true, email: true } },
      },
    }),
    prisma.post.findMany({
      where: {
        status: { in: ["PUBLISHED", "REJECTED"] },
        publishedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { publishedAt: "desc" },
      take: 20,
      select: {
        id: true,
        title: true,
        status: true,
        readMin: true,
        publishedAt: true,
        author: { select: { name: true } },
      },
    }),
  ])

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Content" title="Blog" description="Review and moderate submitted posts" />

      {/* Needs review */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Needs review</h2>
          {pending.length > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
              {pending.length}
            </span>
          )}
        </div>

        {pending.length === 0 ? (
          <div className="rounded-xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            No posts waiting for review.
          </div>
        ) : (
          <div className="rounded-xl border bg-card divide-y">
            {pending.map((post) => (
              <div key={post.id} className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {post.title || <span className="italic text-muted-foreground">Untitled</span>}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{post.author.name ?? post.author.email}</span>
                    {post.submittedAt && (
                      <>
                        <span>·</span>
                        <span>
                          {formatDayMonth(post.submittedAt)}
                        </span>
                      </>
                    )}
                    {post.readMin && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {post.readMin} min
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[post.status] ?? ""}`}>
                  {post.status.replace("_", " ")}
                </span>

                <Link
                  href={`/admin/blog/${post.id}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  Review
                  <ChevronRight className="size-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent reviews */}
      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recently reviewed (30 days)</h2>
          <div className="rounded-xl border bg-card divide-y">
            {recent.map((post) => (
              <div key={post.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {post.title || <span className="italic text-muted-foreground">Untitled</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {post.author.name}
                    {post.publishedAt && (
                      <> · {formatDayMonth(post.publishedAt)}</>
                    )}
                  </p>
                </div>

                <Badge variant="outline" className={`text-xs ${STATUS_BADGE[post.status] ?? ""}`}>
                  {post.status}
                </Badge>

                <Link
                  href={`/admin/blog/${post.id}`}
                  className="inline-flex shrink-0 items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <ChevronRight className="size-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
