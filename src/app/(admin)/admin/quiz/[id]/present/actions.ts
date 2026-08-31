"use server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { createOrGetQuizSession, resumeQuizSession } from "@/lib/quiz-session"
import { secondsUntil } from "@/lib/quiz-live"

export async function createOrGetSession(presentationId: string): Promise<string> {
  await requireStaff()
  const session = await createOrGetQuizSession(presentationId)
  return session.id
}

export async function resumeSession(
  presentationId: string,
  sessionId: string,
): Promise<{ id: string; roomCode: string } | null> {
  await requireStaff()
  return resumeQuizSession(presentationId, sessionId)
}

export async function startSlide(
  sessionId: string,
  slideId: string,
  startedAtEpochMs: number,
): Promise<void> {
  await requireStaff()

  const serverNow = Date.now()
  const requested = Number.isFinite(startedAtEpochMs) ? startedAtEpochMs : serverNow
  // Presenter clocks are normally accurate to milliseconds. Keep a bounded
  // fallback so a wildly wrong device clock cannot produce an hour-long speed
  // bonus, while still preserving the instant the host actually clicked Next.
  const startedAt = new Date(Math.abs(requested - serverNow) <= 60_000 ? requested : serverNow)

  // One statement instead of a session read, slide read, and update. Besides
  // being faster on the free tier, the UPDATE ... FROM condition still proves
  // the slide belongs to this presentation and refuses ended sessions.
  const updated = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "QuizSession" AS qs
    SET
      "currentSlideId" = slide."id",
      "currentSlideStartedAt" = ${startedAt}::timestamp,
      "currentSlideDeadlineAt" = CASE
        WHEN COALESCE((slide."config" ->> 'timerSeconds')::double precision, 0) > 0
          THEN ${startedAt}::timestamp + make_interval(secs => (slide."config" ->> 'timerSeconds')::double precision)
        ELSE NULL
      END,
      "currentSlideLockedAt" = NULL,
      "currentSlideRevealedAt" = NULL,
      "status" = 'active',
      "startedAt" = COALESCE(qs."startedAt", ${startedAt}::timestamp),
      "endedAt" = NULL
    FROM "Slide" AS slide
    WHERE qs."id" = ${sessionId}
      AND qs."status" <> 'ended'
      AND slide."id" = ${slideId}
      AND slide."presentationId" = qs."presentationId"
    RETURNING qs."id"
  `
  if (updated.length === 0) throw new Error("SESSION_OR_SLIDE_NOT_AVAILABLE")
}

export async function lockSlide(sessionId: string, slideId: string): Promise<void> {
  await requireStaff()
  const updated = await prisma.quizSession.updateMany({
    where: {
      id: sessionId,
      status: "active",
      currentSlideId: slideId,
      currentSlideLockedAt: null,
      currentSlideRevealedAt: null,
    },
    data: { currentSlideLockedAt: new Date() },
  })
  if (updated.count === 0) {
    const session = await prisma.quizSession.findUnique({ where: { id: sessionId } })
    if (!session || session.status === "ended") throw new Error("SESSION_ENDED")
    if (session.currentSlideId !== slideId) throw new Error("STALE_SLIDE")
  }
}

export async function unlockSlide(
  sessionId: string,
  slideId: string,
): Promise<{ secondsLeft: number | null }> {
  await requireStaff()

  return prisma.$transaction(async (tx) => {
    const session = await tx.quizSession.findUnique({ where: { id: sessionId } })
    if (!session || session.status === "ended") throw new Error("SESSION_ENDED")
    if (session.currentSlideId !== slideId) throw new Error("STALE_SLIDE")
    if (session.currentSlideRevealedAt) throw new Error("ANSWER_ALREADY_REVEALED")
    if (!session.currentSlideLockedAt) {
      return { secondsLeft: secondsUntil(session.currentSlideDeadlineAt) }
    }

    const now = new Date()
    const pausedMs = Math.max(0, now.getTime() - session.currentSlideLockedAt.getTime())
    const startedAt = session.currentSlideStartedAt
      ? new Date(session.currentSlideStartedAt.getTime() + pausedMs)
      : null
    const deadline = session.currentSlideDeadlineAt
      ? new Date(session.currentSlideDeadlineAt.getTime() + pausedMs)
      : null

    await tx.quizSession.update({
      where: { id: sessionId },
      data: {
        currentSlideStartedAt: startedAt,
        currentSlideDeadlineAt: deadline,
        currentSlideLockedAt: null,
      },
    })

    return { secondsLeft: secondsUntil(deadline, now) }
  })
}

export async function revealSlide(sessionId: string, slideId: string): Promise<void> {
  await requireStaff()
  const updated = await prisma.quizSession.updateMany({
    where: {
      id: sessionId,
      status: "active",
      currentSlideId: slideId,
      currentSlideLockedAt: { not: null },
      currentSlideRevealedAt: null,
    },
    data: { currentSlideRevealedAt: new Date() },
  })
  if (updated.count === 0) {
    const session = await prisma.quizSession.findUnique({ where: { id: sessionId } })
    if (!session || session.status === "ended") throw new Error("SESSION_ENDED")
    if (session.currentSlideId !== slideId) throw new Error("STALE_SLIDE")
    if (!session.currentSlideLockedAt) throw new Error("LOCK_BEFORE_REVEAL")
  }
}

export async function endSession(sessionId: string): Promise<void> {
  await requireStaff()
  await prisma.quizSession.updateMany({
    where: { id: sessionId, status: { not: "ended" } },
    data: {
      status: "ended",
      endedAt: new Date(),
      currentSlideId: null,
      currentSlideStartedAt: null,
      currentSlideDeadlineAt: null,
      currentSlideLockedAt: null,
      currentSlideRevealedAt: null,
    },
  })
}

export async function computeLeaderboard(
  sessionId: string,
): Promise<{ nickname: string; avatar: string; totalPoints: number; rank: number }[]> {
  await requireStaff()

  const rows = await prisma.response.groupBy({
    by: ["nickname"],
    where: { sessionId },
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
  })

  const avatarRows = await prisma.response.findMany({
    where: { sessionId, avatar: { not: null } },
    distinct: ["nickname"],
    orderBy: { createdAt: "desc" },
    select: { nickname: true, avatar: true },
  })
  const avatars = new Map(avatarRows.map((r) => [r.nickname ?? "", r.avatar ?? ""]))

  return rows.map((r, i) => ({
    nickname: r.nickname ?? "Anonymous",
    avatar: avatars.get(r.nickname ?? "") ?? "",
    totalPoints: r._sum.points ?? 0,
    rank: i + 1,
  }))
}
