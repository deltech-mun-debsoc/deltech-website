import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"

export const quizSessionCacheTag = (sessionId: string) => `quiz-session:${sessionId}`
export const quizSlideCacheTag = (slideId: string) => `quiz-slide:${slideId}`

export type LiveQuizSnapshot = {
  id: string
  roomCode: string
  status: string
  presentationId: string
  presentationMode: "POLL" | "QUIZ"
  presentationTitle: string
  currentSlideId: string | null
  currentSlideStartedAt: Date | null
  currentSlideDeadlineAt: Date | null
  currentSlideLockedAt: Date | null
  currentSlideRevealedAt: Date | null
  slideId: string | null
  slideOrder: number | null
  slideType: string | null
  slidePrompt: string | null
  slideConfig: unknown
  slideCount: number
}

async function readLiveSnapshot(column: "id" | "roomCode", value: string): Promise<LiveQuizSnapshot | null> {
  const rows = column === "id"
    ? await prisma.$queryRaw<LiveQuizSnapshot[]>`
        SELECT qs."id", qs."roomCode", qs."status", qs."presentationId",
               qs."currentSlideId", qs."currentSlideStartedAt", qs."currentSlideDeadlineAt",
               qs."currentSlideLockedAt", qs."currentSlideRevealedAt",
               p."mode" AS "presentationMode", p."title" AS "presentationTitle",
               s."id" AS "slideId", s."order" AS "slideOrder", s."type"::text AS "slideType",
               s."prompt" AS "slidePrompt", s."config" AS "slideConfig",
               (SELECT COUNT(*)::int FROM "Slide" all_slides
                WHERE all_slides."presentationId" = qs."presentationId") AS "slideCount"
        FROM "QuizSession" qs
        JOIN "Presentation" p ON p."id" = qs."presentationId"
        LEFT JOIN "Slide" s ON s."id" = qs."currentSlideId"
        WHERE qs."id" = ${value}
        LIMIT 1
      `
    : await prisma.$queryRaw<LiveQuizSnapshot[]>`
        SELECT qs."id", qs."roomCode", qs."status", qs."presentationId",
               qs."currentSlideId", qs."currentSlideStartedAt", qs."currentSlideDeadlineAt",
               qs."currentSlideLockedAt", qs."currentSlideRevealedAt",
               p."mode" AS "presentationMode", p."title" AS "presentationTitle",
               s."id" AS "slideId", s."order" AS "slideOrder", s."type"::text AS "slideType",
               s."prompt" AS "slidePrompt", s."config" AS "slideConfig",
               (SELECT COUNT(*)::int FROM "Slide" all_slides
                WHERE all_slides."presentationId" = qs."presentationId") AS "slideCount"
        FROM "QuizSession" qs
        JOIN "Presentation" p ON p."id" = qs."presentationId"
        LEFT JOIN "Slide" s ON s."id" = qs."currentSlideId"
        WHERE qs."roomCode" = ${value}
        LIMIT 1
      `
  return rows[0] ?? null
}

// Realtime remains the immediate path. This shared cache is the recovery path:
// 150 phones polling after a Wi-Fi wobble should cause one database read, not
// 150 identical four-query bundles. Presenter mutations invalidate the tag.
export async function cachedLiveQuizSnapshot(sessionId: string): Promise<LiveQuizSnapshot | null> {
  return unstable_cache(
    () => readLiveSnapshot("id", sessionId),
    ["live-quiz-session", sessionId],
    { revalidate: 30, tags: [quizSessionCacheTag(sessionId)] },
  )()
}

export async function liveQuizSnapshotByCode(roomCode: string): Promise<LiveQuizSnapshot | null> {
  return readLiveSnapshot("roomCode", roomCode)
}

export async function cachedScoringSlide(slideId: string) {
  return unstable_cache(
    () => prisma.slide.findUnique({
      where: { id: slideId },
      select: { type: true, config: true },
    }),
    ["quiz-scoring-slide", slideId],
    { revalidate: 300, tags: [quizSlideCacheTag(slideId)] },
  )()
}
