"use server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { createOrGetQuizSession, resumeQuizSession } from "@/lib/quiz-session"
import { parseConfig } from "@/lib/quiz-types"
import { slideTimerSeconds, secondsUntil } from "@/lib/quiz-live"
import type { SlideType } from "@/lib/quiz-types"

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
): Promise<{ secondsLeft: number | null }> {
  await requireStaff()

  return prisma.$transaction(async (tx) => {
    const [session, row] = await Promise.all([
      tx.quizSession.findUnique({ where: { id: sessionId } }),
      tx.slide.findUnique({ where: { id: slideId } }),
    ])
    if (!session || session.status === "ended") throw new Error("SESSION_ENDED")
    if (!row || row.presentationId !== session.presentationId) throw new Error("SLIDE_NOT_IN_SESSION")

    const type = row.type as SlideType
    const timer = slideTimerSeconds({ type, config: parseConfig(row.config, type) })
    const now = new Date()
    const deadline = timer === null ? null : new Date(now.getTime() + timer * 1000)

    await tx.quizSession.update({
      where: { id: sessionId },
      data: {
        currentSlideId: slideId,
        currentSlideStartedAt: now,
        currentSlideDeadlineAt: deadline,
        currentSlideLockedAt: null,
        currentSlideRevealedAt: null,
        status: "active",
        startedAt: session.startedAt ?? now,
        endedAt: null,
      },
    })

    return { secondsLeft: timer }
  })
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
