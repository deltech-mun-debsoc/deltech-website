import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { asMCQ, asOpenText, asScale, asWordCloud, parseConfig } from "@/lib/quiz-types"
import type { SlideConfig } from "@/lib/quiz-types"
import type { SlideType } from "@/lib/quiz-types"
import { scoreAnswer } from "@/lib/quiz-scoring"
import { normalizeQuizNickname } from "@/lib/quiz-live"

type LockedQuizSession = {
  status: string
  currentSlideId: string | null
  currentSlideStartedAt: Date | null
  currentSlideDeadlineAt: Date | null
  currentSlideLockedAt: Date | null
  currentSlideRevealedAt: Date | null
}

type AnswerOutcome =
  | { error: string; status: 404 | 408 | 409 | 410 | 423 }
  | { pending: true; alreadySubmitted: boolean }
  | {
      correct: boolean | null
      points: number
      nickname: string
      streakBonus: number
      alreadySubmitted: true
    }

function validAnswer(type: SlideType, config: SlideConfig, answer: unknown): boolean {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false
  if (type === "MCQ" || type === "TRUE_FALSE") {
    const selected = (answer as { selectedIndices?: unknown }).selectedIndices
    const options = asMCQ(config).options
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > options.length) return false
    if (!asMCQ(config).allowMultiple && selected.length !== 1) return false
    return new Set(selected).size === selected.length && selected.every(
      (index) => Number.isInteger(index) && Number(index) >= 0 && Number(index) < options.length,
    )
  }
  if (type === "TYPE_ANSWER") {
    const text = (answer as { text?: unknown }).text
    return typeof text === "string" && text.trim().length > 0 && text.length <= 500
  }
  if (type === "NUMERIC") {
    const value = (answer as { value?: unknown }).value
    return typeof value === "number" && Number.isFinite(value)
  }
  if (type === "WORDCLOUD") {
    const words = (answer as { words?: unknown }).words
    const limit = asWordCloud(config).allowMultiple ? 10 : 1
    return Array.isArray(words) && words.length >= 1 && words.length <= limit &&
      words.every((word) => typeof word === "string" && word.trim().length > 0 && word.length <= 80)
  }
  if (type === "SCALE") {
    const values = (answer as { values?: unknown }).values
    const scale = asScale(config)
    return Array.isArray(values) && values.length === scale.statements.length && values.every(
      (value) => Number.isInteger(value) && Number(value) >= scale.min && Number(value) <= scale.max,
    )
  }
  if (type === "OPEN_TEXT") {
    const text = (answer as { text?: unknown }).text
    return typeof text === "string" && text.trim().length > 0 && text.length <= asOpenText(config).maxLength
  }
  return false
}

async function participantRank(sessionId: string, nickname: string, fallbackPoints = 0): Promise<number> {
  const mine = await prisma.response.aggregate({
    where: { sessionId, nickname: { equals: nickname, mode: "insensitive" } },
    _sum: { points: true },
  })
  const myTotal = mine._sum.points ?? fallbackPoints
  const ahead = await prisma.response.groupBy({
    by: ["nickname"],
    where: { sessionId },
    _sum: { points: true },
    having: { points: { _sum: { gt: myTotal } } },
  })
  return ahead.length + 1
}

// POST, participant submits an answer or idempotently recovers its result.
export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId: string
    slideId: string
    nickname: string
    avatar: string
    answer: unknown
    recoverOnly?: boolean
  }
  const { sessionId, slideId, answer } = body
  const nickname = normalizeQuizNickname(body.nickname)
  if (!sessionId || !slideId || !nickname) {
    return NextResponse.json({ error: "invalid_identity" }, { status: 400 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const limit = await rateLimit(RATE_LIMITS.quizAnswer, `${sessionId}:${ip}`)
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    )
  }

  const slide = await prisma.slide.findUnique({
    where: { id: slideId },
    select: { type: true, config: true },
  })
  if (!slide) return NextResponse.json({ error: "slide_not_found" }, { status: 404 })
  const type = slide.type as SlideType
  const config = parseConfig(slide.config, type)
  if (!body.recoverOnly && !validAnswer(type, config, answer)) {
    return NextResponse.json({ error: "invalid_answer" }, { status: 422 })
  }

  // Answers take a shared lock on the session row. They can still arrive in
  // parallel, but lock/reveal/end must serialize with them. A request either
  // commits before voting closes or waits and observes the closed state; there
  // is no read-then-write window for a last-millisecond answer to slip through.
  let outcome: AnswerOutcome
  try {
    outcome = await prisma.$transaction<AnswerOutcome>(async (tx) => {
      const rows = await tx.$queryRaw<LockedQuizSession[]>`
        SELECT "status", "currentSlideId", "currentSlideStartedAt",
               "currentSlideDeadlineAt", "currentSlideLockedAt", "currentSlideRevealedAt"
        FROM "QuizSession"
        WHERE "id" = ${sessionId}
        FOR SHARE
      `
      const session = rows[0]
      if (!session || session.status === "ended") return { error: "session_ended", status: 410 }
      if (session.status !== "active" || session.currentSlideId !== slideId) {
        return { error: "slide_not_active", status: 409 }
      }

      const existing = await tx.response.findFirst({
        where: { sessionId, slideId, nickname: { equals: nickname, mode: "insensitive" } },
      })
      if (existing) {
        // Before reveal, a replay gets only a receipt. Returning the stored score
        // here would make devtools an answer oracle while others are still voting.
        if (!session.currentSlideRevealedAt) {
          return { pending: true, alreadySubmitted: true }
        }
        const recovered = scoreAnswer({ type, config, answer: existing.answer, elapsedSeconds: null, streak: 0 })
        return {
          correct: recovered.correct,
          points: existing.points,
          nickname: existing.nickname ?? nickname,
          streakBonus: 0,
          alreadySubmitted: true,
        }
      }

      if (body.recoverOnly) return { error: "response_not_found", status: 404 }

      if (session.currentSlideRevealedAt) return { error: "answer_revealed", status: 423 }
      if (session.currentSlideLockedAt) return { error: "voting_locked", status: 423 }
      if (session.currentSlideDeadlineAt && session.currentSlideDeadlineAt.getTime() <= Date.now()) {
        return { error: "time_up", status: 408 }
      }

      const recent = await tx.response.findMany({
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
      const elapsedSeconds = session.currentSlideStartedAt
        ? (Date.now() - session.currentSlideStartedAt.getTime()) / 1000
        : null
      const scored = scoreAnswer({ type, config, answer, elapsedSeconds, streak })

      await tx.response.create({
        data: {
          sessionId,
          slideId,
          nickname,
          avatar: typeof body.avatar === "string" ? body.avatar : null,
          answer: answer as never,
          points: scored.points,
        },
      })
      // Score is committed now but intentionally withheld until reveal.
      return { pending: true, alreadySubmitted: false }
    })
  } catch (err) {
    // A double tap can race through the friendly lookup, but the database's
    // normalized unique index decides one winner. The losing transaction is
    // rolled back in full and receives the same neutral receipt.
    if (
      typeof err === "object" && err !== null && "code" in err &&
      (err as { code: unknown }).code === "P2002"
    ) {
      return NextResponse.json({
        correct: null,
        points: 0,
        rank: null,
        streakBonus: 0,
        alreadySubmitted: true,
        pendingReveal: true,
      })
    }
    throw err
  }

  if ("error" in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }
  if ("pending" in outcome) {
    return NextResponse.json({
      correct: null,
      points: 0,
      rank: null,
      streakBonus: 0,
      alreadySubmitted: outcome.alreadySubmitted,
      pendingReveal: true,
    })
  }

  const rank = outcome.correct === null
    ? null
    : await participantRank(sessionId, outcome.nickname, outcome.points)
  return NextResponse.json({ ...outcome, rank })
}
