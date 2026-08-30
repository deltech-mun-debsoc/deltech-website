import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { parseConfig, parseTheme } from "@/lib/quiz-types"
import type { SlideType, SlideData } from "@/lib/quiz-types"
import { createOrGetSession, resumeSession } from "./actions"
import { PresenterApp } from "./_components/presenter-app"

export default async function PresentPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ session?: string }>
}) {
  const authSession = await auth()
  const role = (authSession?.user as { role?: string } | undefined)?.role
  if (!authSession || (role !== "ADMIN" && role !== "MAINTAINER")) {
    return notFound()
  }

  const { id } = await props.params

  const raw = await prisma.presentation.findUnique({
    where: { id },
    include: { slides: { orderBy: { order: "asc" } } },
  })
  if (!raw) notFound()

  const slides: SlideData[] = raw.slides.map((s) => {
    const type = s.type as SlideType
    return {
      id: s.id,
      order: s.order,
      type,
      prompt: s.prompt,
      config: parseConfig(s.config, type),
    }
  })

  // Which run this is. The id lives in the URL so a reload resumes the same run
  // -- same code, same scores -- while arriving here without one (clicking
  // Present again) deliberately starts a fresh run instead of inheriting the
  // last audience's answers.
  const { session: requested } = await props.searchParams
  const session = requested ? await resumeSession(id, requested) : null
  if (!session) {
    redirect(`/admin/quiz/${id}/present?session=${await createOrGetSession(id)}`)
  }

  const presentation = {
    id: raw.id,
    title: raw.title,
    mode: raw.mode as "POLL" | "QUIZ",
    theme: parseTheme(raw.theme),
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <PresenterApp session={session} presentation={presentation} slides={slides} />
    </div>
  )
}
