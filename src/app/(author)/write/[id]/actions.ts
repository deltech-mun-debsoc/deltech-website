"use server"

import { requireAuthor as requireAuthorRole } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"

async function requireAuthor(postId: string) {
  // Ownership survives a role change; authoring permission does not.
  const session = await requireAuthorRole()
  const post = await prisma.post.findUnique({
    where:  { id: postId },
    select: { authorId: true, slug: true, status: true },
  })
  if (!post || post.authorId !== session.user.id) {
    throw new Error("Not authorized")
  }
  return { userId: session.user.id, post }
}

function makeSlug(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-$/, "")
  const suffix = id.slice(-7)
  return base ? `${base}-${suffix}` : `untitled-${suffix}`
}

export async function saveDraft(
  postId: string,
  data: {
    title:       string
    subtitle:    string
    contentJson: Record<string, unknown>
    tags:        string[]
    coverImage?: string
    readMin:     number
  },
): Promise<{ success: boolean; error?: string; slug?: string }> {
  try {
    const { post } = await requireAuthor(postId)
    if (post.status === "PUBLISHED") return { success: false, error: "Cannot edit a published post." }

    // Generate slug from title on first meaningful save
    const isDraftSlug = post.slug.startsWith("draft-")
    const newSlug = isDraftSlug && data.title.trim()
      ? makeSlug(data.title, postId)
      : post.slug

    await prisma.post.update({
      where: { id: postId },
      data: {
        title:       data.title,
        subtitle:    data.subtitle || null,
        contentJson: data.contentJson as Prisma.InputJsonValue,
        tags:        data.tags,
        coverImage:  data.coverImage ?? null,
        readMin:     data.readMin,
        slug:        newSlug,
        // Autosave must not change the review state. This forced "DRAFT"
        // unconditionally, and the editor autosaves 1.5s after any keystroke,
        // so an author fixing a typo while awaiting review silently pulled
        // their own post out of the admin queue. Nothing told either side, and
        // the Submit button stayed hidden because canSubmit came from the
        // initial server prop.
        status:      post.status === "PENDING" ? "PENDING" : "DRAFT",
      },
    })
    return { success: true, slug: newSlug }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Save failed." }
  }
}

export async function submitPost(
  postId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { post } = await requireAuthor(postId)
    if (post.status !== "DRAFT" && post.status !== "CHANGES_REQUESTED") {
      return { success: false, error: "Post is not in a submittable state." }
    }
    await prisma.post.update({
      where: { id: postId },
      data: { status: "PENDING", submittedAt: new Date(), reviewNote: null },
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Submit failed." }
  }
}
