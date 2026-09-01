"use server"

import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireAdmin, requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { deleteObject } from "@/lib/media/s3"


// A failed notification must not undo a completed review, but it also must not
// vanish: EmailLog records it and the failed-email card on /admin surfaces it.
async function notifyAuthor(send: () => Promise<void>): Promise<void> {
  try {
    await send()
  } catch (err) {
    console.error("[blog review] author notification failed", err)
  }
}

export async function approvePost(postId: string): Promise<{ error?: string }> {
  const session = await requireStaff()
  try {
    await prisma.post.update({
      where: { id: postId },
      data: { status: "PUBLISHED", publishedAt: new Date(), reviewNote: null },
    })
    await audit(session.user?.email ?? "unknown", "post.approve", "Post", postId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to approve." }
  }
  await notifyAuthor(() => import("@/lib/resend").then((m) => m.sendBlogApproved(postId)))
  redirect("/admin/blog")
}

export async function requestChanges(
  postId: string,
  reviewNote: string,
): Promise<{ error?: string }> {
  const session = await requireStaff()
  try {
    await prisma.post.update({
      where: { id: postId },
      data: { status: "CHANGES_REQUESTED", reviewNote },
    })
    await audit(session.user?.email ?? "unknown", "post.requestChanges", "Post", postId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." }
  }
  await notifyAuthor(() => import("@/lib/resend").then((m) => m.sendBlogChangesRequested(postId)))
  redirect("/admin/blog")
}

export async function rejectPost(
  postId: string,
  reason: string,
): Promise<{ error?: string }> {
  const session = await requireStaff()
  try {
    await prisma.post.update({
      where: { id: postId },
      data: { status: "REJECTED", reviewNote: reason },
    })
    await audit(session.user?.email ?? "unknown", "post.reject", "Post", postId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reject." }
  }
  // Rejection used to send nothing at all, unlike approve and requestChanges.
  // The author saw a red badge with no reason and could not resubmit.
  await notifyAuthor(() => import("@/lib/resend").then((m) => m.sendBlogRejected(postId)))
  redirect("/admin/blog")
}

// Hard delete, ADMIN only: this is the one blog action with nothing behind it.
// Rejection keeps the row so the author can read the reason and resubmit, which
// is why REJECTED is not a delete; this is for a post that should stop existing.
//
// The images go too. MediaAsset carries a free-form ownerType/ownerId pointer
// rather than a foreign key, so nothing cascades, and the orphan sweep only
// collects PENDING and FAILED uploads -- a READY cover image would have stayed
// in the bucket, publicly reachable at its URL, after the post it belonged to
// was deleted. For a post pulled *because* it should not be public, leaving the
// cover art served forever is the wrong default.
export async function deletePost(postId: string): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, title: true, slug: true, status: true, authorId: true },
  })
  if (!post) return { error: "That post no longer exists." }

  const assets = await prisma.mediaAsset.findMany({
    where: { ownerType: "Post", ownerId: postId, deletedAt: null },
    select: { id: true, objectKey: true },
  })

  try {
    // Bucket first, database second. The reverse order can lose the objectKey to
    // a crash and orphan the bytes with nothing left pointing at them; this
    // order can at worst delete bytes and keep a row, which the next attempt
    // finishes (deleteObject treats a missing object as success).
    for (const asset of assets) {
      try {
        await deleteObject(asset.objectKey)
      } catch (err) {
        // S3 unreachable or unconfigured must not strand the post itself. The
        // row is left alone so the failure stays visible in /admin/media.
        console.error(`[blog delete] could not remove ${asset.objectKey}`, err)
      }
    }
    if (assets.length > 0) {
      await prisma.mediaAsset.updateMany({
        where: { id: { in: assets.map((a) => a.id) } },
        data: { deletedAt: new Date(), publicUrl: null },
      })
    }

    await prisma.post.delete({ where: { id: postId } })

    // The row is gone, so the audit entry is the only remaining record of what
    // was removed. Keep enough of it to answer "what was that post?".
    await audit(session.user?.email ?? "unknown", "post.delete", "Post", postId, {
      title: post.title,
      slug: post.slug,
      status: post.status,
      authorId: post.authorId,
      mediaRemoved: assets.length,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete." }
  }

  redirect("/admin/blog")
}
