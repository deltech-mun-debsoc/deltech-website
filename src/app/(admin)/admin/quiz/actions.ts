"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireAdmin, requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"

// Creating is a POST, never a GET.
//
// This used to be GET /admin/quiz/new, reached by an ordinary link. Next
// prefetches links, so simply having the button on screen created a
// presentation: production collected 46 empty ones that way. A form posting to
// an action cannot be prefetched.
export async function createPresentation(): Promise<never> {
  const session = await requireStaff()
  const presentation = await prisma.presentation.create({
    data: { ownerId: session.user!.id!, title: "Untitled presentation", mode: "POLL" },
  })
  revalidatePath("/admin/quiz")
  redirect(`/admin/quiz/${presentation.id}`)
}

// Archiving only moves a show off the library's main view. Slides, runs and
// results are untouched and it can be restored, so any staff member may do it.
export async function setPresentationArchived(id: string, archived: boolean): Promise<{ error?: string }> {
  const session = await requireStaff()
  const { count } = await prisma.presentation.updateMany({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  })
  if (count === 0) return { error: "That presentation no longer exists." }
  await audit(session.user!.email!, archived ? "presentation.archive" : "presentation.unarchive", "Presentation", id)
  revalidatePath("/admin/quiz")
  return {}
}

// Deleting a presentation takes its slides, every run and every answer with it,
// so this is ADMIN only, unlike the rest of the quiz editor (requireStaff).
// Runs and responses are not tied to the presentation by foreign keys, so they
// are removed explicitly here rather than left stranded. The results page offers
// a CSV of each run first.
export async function deletePresentation(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()
  try {
    const removed = await prisma.$transaction(async (tx) => {
      const presentation = await tx.presentation.findUnique({ where: { id }, select: { title: true } })
      if (!presentation) return null
      const runs = await tx.quizSession.findMany({ where: { presentationId: id }, select: { id: true } })
      const runIds = runs.map((r) => r.id)
      const responses = await tx.response.deleteMany({ where: { sessionId: { in: runIds } } })
      await tx.quizSession.deleteMany({ where: { id: { in: runIds } } })
      await tx.slide.deleteMany({ where: { presentationId: id } })
      await tx.presentation.delete({ where: { id } })
      return { title: presentation.title, runs: runIds.length, responses: responses.count }
    })
    if (!removed) return { error: "That presentation no longer exists." }

    await audit(session.user!.email!, "presentation.delete", "Presentation", id, removed)
    revalidatePath("/admin/quiz")
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete that presentation." }
  }
}

// One run: a rehearsal, or a real audience whose results are no longer wanted.
export async function deleteQuizRun(sessionId: string): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const run = await prisma.quizSession.findUnique({
    where: { id: sessionId },
    select: { presentationId: true, roomCode: true },
  })
  if (!run) return { error: "That run no longer exists." }

  const [responses] = await prisma.$transaction([
    prisma.response.deleteMany({ where: { sessionId } }),
    prisma.quizSession.delete({ where: { id: sessionId } }),
  ])
  await audit(session.user!.email!, "quiz.run.delete", "QuizSession", sessionId, {
    presentationId: run.presentationId,
    roomCode: run.roomCode,
    responses: responses.count,
  })
  revalidatePath(`/admin/quiz/${run.presentationId}/results`)
  revalidatePath("/admin/quiz")
  return {}
}
