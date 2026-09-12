"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { requireAuthor } from "@/lib/authz"
import { prisma } from "@/lib/prisma"

// Creating a draft is a POST, never a GET.
//
// This used to be GET /write/new behind an ordinary link. Next prefetches links,
// so having the "New story" button on screen was enough to create a draft. The
// quiz version of the same mistake left 46 empty presentations in production.
export async function createDraft(): Promise<never> {
  const session = await requireAuthor()

  const post = await prisma.post.create({
    data: {
      authorId: session.user.id,
      title: "",
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      slug: `draft-${Date.now()}-${session.user.id.slice(-6)}`,
      status: "DRAFT",
    },
    select: { id: true },
  })

  revalidatePath("/write")
  redirect(`/write/${post.id}`)
}
