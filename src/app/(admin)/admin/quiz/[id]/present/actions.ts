"use server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { createOrGetQuizSession } from "@/lib/quiz-session"

export async function createOrGetSession(presentationId: string): Promise<string> {
  await requireStaff()
  const session = await createOrGetQuizSession(presentationId)
  return session.id
}

// Records which slide is live and when it went live, so scoring does not have
// to trust the participant's clock. The presenter broadcasts GOTO over
// Realtime for latency; this is the authoritative record.
export async function startSlide(sessionId: string, slideId: string): Promise<void> {
  await requireStaff()
  await prisma.quizSession.update({
    where: { id: sessionId },
    data: { currentSlideId: slideId, currentSlideStartedAt: new Date(), status: "active" },
  })
}

export async function endSession(sessionId: string): Promise<void> {
  await requireStaff()
  await prisma.quizSession.update({
    where: { id: sessionId },
    data: { status: "ended", endedAt: new Date() },
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

  // Avatars come off the response rows now. They used to come only from the live
  // presence channel, so anyone who closed their phone before the final board
  // was shown appeared as a generic silhouette next to their own score.
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

