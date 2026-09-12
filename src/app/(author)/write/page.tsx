import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { createDraft } from "./actions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PenLine, Clock } from "lucide-react"
import { AccountLink } from "@/components/account-link"
import { SignOutButton } from "@/components/sign-out-button"

const STATUS_LABEL: Record<string, string> = {
  DRAFT:             "Draft",
  PENDING:           "In review",
  CHANGES_REQUESTED: "Changes needed",
  PUBLISHED:         "Published",
  REJECTED:          "Rejected",
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT:             "secondary",
  PENDING:           "outline",
  CHANGES_REQUESTED: "destructive",
  PUBLISHED:         "default",
  REJECTED:          "destructive",
}

export default async function WritePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  const posts = await prisma.post.findMany({
    where:   { authorId: session.user.id },
    orderBy: { submittedAt: "desc" },
    select:  {
      id:          true,
      title:       true,
      subtitle:    true,
      status:      true,
      readMin:     true,
      publishedAt: true,
      submittedAt: true,
      reviewNote:  true,
    },
  })

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-gray-900">Your stories</h1>
          <p className="mt-1 text-sm text-gray-500">{posts.length} post{posts.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* The author area had no header controls at all, so a pure AUTHOR
              could neither sign out nor reach /account to set a password. */}
          <AccountLink compact />
          <SignOutButton compact />
          <form action={createDraft}>
            <Button type="submit" className="gap-2">
              <PenLine className="size-4" />
              New story
            </Button>
          </form>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="py-20 text-center">
          <PenLine className="mx-auto mb-4 size-10 text-gray-300" />
          <p className="text-gray-400">No stories yet. Start writing!</p>
          <form action={createDraft}>
            <Button type="submit" className="mt-6">Write your first story</Button>
          </form>
        </div>
      ) : (
        <ul className="space-y-4">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/write/${post.id}`}
                className="group block rounded-xl border border-gray-100 bg-white p-6 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-serif text-lg font-semibold text-gray-900 group-hover:text-teal-700">
                      {post.title || <span className="text-gray-400">Untitled</span>}
                    </p>
                    {post.subtitle && (
                      <p className="mt-0.5 truncate text-sm text-gray-500">{post.subtitle}</p>
                    )}
                    {/* REJECTED was excluded here, so a rejected author saw a
                        red badge and no reason anywhere in the product. */}
                    {post.reviewNote &&
                      (post.status === "CHANGES_REQUESTED" || post.status === "REJECTED") && (
                        <p
                          className={
                            post.status === "REJECTED"
                              ? "mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
                              : "mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700"
                          }
                        >
                          {post.reviewNote}
                        </p>
                      )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Badge variant={STATUS_VARIANT[post.status] ?? "secondary"} className="text-[11px]">
                      {STATUS_LABEL[post.status] ?? post.status}
                    </Badge>
                    {post.readMin && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Clock className="size-3" />
                        {post.readMin} min
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
