import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { parseConfig } from "@/lib/quiz-types"
import type { SlideType } from "@/lib/quiz-types"
import { scoreAnswer } from "@/lib/quiz-scoring"

// Consecutive correct answers immediately before this one, newest first. Points
// are the proxy for correctness on an already-stored row: a scored slide only
// awards points when something was right.
async function currentStreak(sessionId: string, nickname: string): Promise<number> {
  const recent = await prisma.response.findMany({
    where: { sessionId, nickname },
    orderBy: { createdAt: "desc" },
    select: { points: true },
    take: 10,
  })
  let streak = 0
  for (const row of recent) {
    if (row.points <= 0) break
    streak++
  }
  return streak
}

// POST, participant submits an answer
export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string
    slideId: string
    nickname: string
    avatar: string
    answer: unknown
  }

  // NOTE: the body used to carry `submittedAt`, which fed the speed bonus
  // directly. Anyone could POST 0 and score full marks on every correct
  // answer regardless of how long they actually took. Elapsed time is now
  // derived from QuizSession.currentSlideStartedAt and the request body's
  // clock is ignored entirely.
  const { sessionId, slideId, nickname, answer } = body

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const limit = await rateLimit(RATE_LIMITS.quizAnswer, `${sessionId}:${ip}`)
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    )
  }

  // These three are independent, so one round trip instead of three. On a
  // phone at the venue that is most of the perceived latency of answering.
  const [session, slide, existing] = await Promise.all([
    prisma.quizSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        presentationId: true,
        currentSlideId: true,
        currentSlideStartedAt: true,
      },
    }),
    prisma.slide.findUnique({
      where: { id: slideId },
      select: { type: true, config: true },
    }),
    prisma.response.findFirst({ where: { sessionId, slideId, nickname } }),
  ])
  if (!session || session.status === "ended") {
    return NextResponse.json({ error: "session_not_active" }, { status: 400 })
  }
  if (!slide) return NextResponse.json({ error: "slide_not_found" }, { status: 404 })

  // Answers are only accepted for the slide the presenter has actually put on
  // screen. Without this, any slide could be answered at any time, including
  // ones already past.
  if (session.currentSlideId && session.currentSlideId !== slideId) {
    return NextResponse.json({ error: "slide_not_active" }, { status: 409 })
  }

  // Friendly path only; the unique index is the actual guard on the create.
  if (existing) {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 })
  }

  // Score. Every question type routes through the same pure scorer, which takes
  // elapsed time as an INPUT derived from the server's record of when the slide
  // went live. The request body's clock is not consulted, here or anywhere.
  const type = slide.type as SlideType
  const config = parseConfig(slide.config, type)

  const startedAt = session.currentSlideStartedAt
  const elapsedSeconds = startedAt ? (Date.now() - startedAt.getTime()) / 1000 : null

  // Streak: how many correct answers this participant already has in a row.
  // Counted from their own submitted responses, so it cannot be forged.
  const streak = nickname ? await currentStreak(sessionId, nickname) : 0

  const scored = scoreAnswer({ type, config, answer, elapsedSeconds, streak })
  const { correct, points } = scored

  // The findFirst above is only for the friendly 409. This is the real guard:
  // two taps milliseconds apart both cleared that check and scored twice.
  try {
    await prisma.response.create({
      data: {
        sessionId,
        slideId,
        nickname,
        // Kept on the row so the final leaderboard still knows who someone was
        // after they close their phone and leave the presence channel.
        avatar: typeof body.avatar === "string" ? body.avatar : null,
        answer: answer as never,
        points,
      },
    })
  } catch (err) {
    if (
      typeof err === "object" && err !== null && "code" in err &&
      (err as { code: unknown }).code === "P2002"
    ) {
      return NextResponse.json({ error: "already_submitted" }, { status: 409 })
    }
    throw err
  }

  // Current rank for this participant (total points).
  //
  // This used to groupBy every nickname in the session and filter in JS, so a
  // 200-person 20-slide quiz aggregated over a table growing to 4000 rows on
  // every single submission, all to show one number the participant sees again
  // on the real leaderboard 15 seconds later. Two aggregates instead.
  let rank: number | null = null
  if (correct !== null) {
    const mine = await prisma.response.aggregate({
      where: { sessionId, nickname },
      _sum: { points: true },
    })
    const myTotal = mine._sum.points ?? points

    const ahead = await prisma.response.groupBy({
      by: ["nickname"],
      where: { sessionId },
      _sum: { points: true },
      having: { points: { _sum: { gt: myTotal } } },
    })
    rank = ahead.length + 1
  }

  return NextResponse.json({ correct, points, rank, streakBonus: scored.streakBonus ?? 0 })
}
