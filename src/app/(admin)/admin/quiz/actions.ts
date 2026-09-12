"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { audit } from "@/lib/audit"

// Deleting a presentation takes every slide with it, so this is ADMIN only,
// unlike the rest of the quiz editor (requireStaff). Nothing here is
// recoverable from the UI afterwards.
export async function deletePresentation(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()
  try {
    const presentation = await prisma.presentation.findUnique({
      where: { id },
      select: { title: true },
    })
    if (!presentation) return { error: "That presentation no longer exists." }

    // A show that has been played is somebody's record of a real event: its
    // sessions hold the participants and their answers, and they are not tied
    // to the presentation by a foreign key, so deleting the slides would strand
    // them rather than clean them up. Refuse instead.
    const played = await prisma.quizSession.count({ where: { presentationId: id } })
    if (played > 0) {
      return {
        error: `"${presentation.title}" has been played ${played} time${played === 1 ? "" : "s"}. Deleting it would strand those results, so it has to stay.`,
      }
    }

    // Slides have no cascade on the relation, so they go first.
    await prisma.$transaction([
      prisma.slide.deleteMany({ where: { presentationId: id } }),
      prisma.presentation.delete({ where: { id } }),
    ])

    await audit(session.user!.email!, "presentation.delete", "Presentation", id)
    revalidatePath("/admin/quiz")
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete that presentation." }
  }
}
