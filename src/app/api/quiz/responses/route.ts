import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { cachedLiveQuizSnapshot, cachedScoringSlide } from "@/lib/quiz-cache"
import { sealQuizResultReceipt, type QuizResultReceipt } from "@/lib/quiz-result-receipt"
import { asMCQ, asOpenText, asScale, asWordCloud, parseConfig } from "@/lib/quiz-types"
import type { SlideConfig } from "@/lib/quiz-types"
import type { SlideType } from "@/lib/quiz-types"
import { scoreAnswer } from "@/lib/quiz-scoring"
import { normalizeQuizNickname } from "@/lib/quiz-live"
import { admitQuizAnswer } from "@/lib/quiz-answer-batcher"

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
  | { pending: true; alreadySubmitted: boolean; receipt: QuizResultReceipt }
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

  if (body.recoverOnly) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    // Recovery can be repeated, so it keeps a per-person throttle. A normal
    // answer is already one atomic, unique, hard-capped insert below; a second
    // limiter write would double the hottest path for no additional protection.
    const limit = await rateLimit(RATE_LIMITS.quizAnswer, `${sessionId}:${nickname}:${ip}`)
    if (!limit.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      )
    }
  }

  const liveSnapshot = body.recoverOnly ? null : await cachedLiveQuizSnapshot(sessionId)
  const slide = liveSnapshot?.currentSlideId === slideId && liveSnapshot.slideType
    ? { type: liveSnapshot.slideType, config: liveSnapshot.slideConfig }
    : await cachedScoringSlide(slideId)
  if (!slide) return NextResponse.json({ error: "slide_not_found" }, { status: 404 })
  const type = slide.type as SlideType
  const config = parseConfig(slide.config, type)
  if (!body.recoverOnly && !validAnswer(type, config, answer)) {
    return NextResponse.json({ error: "invalid_answer" }, { status: 422 })
  }

  let outcome: AnswerOutcome
  if (body.recoverOnly) {
    const [sessions, existing] = await Promise.all([
      prisma.$queryRaw<LockedQuizSession[]>`
        SELECT "status", "currentSlideId", "currentSlideStartedAt", "currentSlideDeadlineAt",
               "currentSlideLockedAt", "currentSlideRevealedAt"
        FROM "QuizSession" WHERE "id" = ${sessionId}
      `,
      prisma.response.findFirst({
        where: { sessionId, slideId, nickname: { equals: nickname, mode: "insensitive" } },
      }),
    ])
    const session = sessions[0]
    if (!session || session.status === "ended") outcome = { error: "session_ended", status: 410 }
    else if (session.status !== "active" || session.currentSlideId !== slideId) {
      outcome = { error: "slide_not_active", status: 409 }
    } else if (!existing) outcome = { error: "response_not_found", status: 404 }
    else {
      const recovered = scoreAnswer({ type, config, answer: existing.answer, elapsedSeconds: null, streak: 0 })
      const receipt: QuizResultReceipt = {
        version: 1,
        sessionId,
        slideId,
        nickname: existing.nickname ?? nickname,
        correct: recovered.correct,
        points: existing.points,
        streakBonus: 0,
      }
      outcome = session.currentSlideRevealedAt
        ? { ...receipt, alreadySubmitted: true }
        : { pending: true, alreadySubmitted: true, receipt }
    }
  } else {
    const observed = liveSnapshot
    if (!observed || observed.status === "ended") outcome = { error: "session_ended", status: 410 }
    else if (observed.status !== "active" || observed.currentSlideId !== slideId) {
      outcome = { error: "slide_not_active", status: 409 }
    } else {
      const startedAt = observed.currentSlideStartedAt
        ? new Date(observed.currentSlideStartedAt)
        : null
      const elapsedSeconds = startedAt
        ? (Date.now() - startedAt.getTime()) / 1000
        : null
      const scored = scoreAnswer({ type, config, answer, elapsedSeconds, streak: 0 })
      const configuredStreakStep = (config as { streakBonus?: unknown }).streakBonus
      const streakStep = scored.correct === true && typeof configuredStreakStep === "number" && configuredStreakStep > 0
        ? Math.round(configuredStreakStep)
        : 0
      const avatar = typeof body.avatar === "string" ? body.avatar : null
      // Requests that land on the same Fluid Compute instance within 100ms are
      // committed by one guarded statement. Each request still resolves with
      // its own admission and server-computed score.
      const admitted = await admitQuizAnswer({
        sessionId,
        slideId,
        nickname,
        avatar,
        answer,
        basePoints: scored.points,
        streakStep,
      })
      if (!admitted || admitted.status === "ended") outcome = { error: "session_ended", status: 410 }
      else if (admitted.status !== "active" || admitted.currentSlideId !== slideId) {
        outcome = { error: "slide_not_active", status: 409 }
      } else if (admitted.currentSlideRevealedAt) outcome = { error: "answer_revealed", status: 423 }
      else if (admitted.currentSlideLockedAt) outcome = { error: "voting_locked", status: 423 }
      else if (admitted.currentSlideDeadlineAt && admitted.currentSlideDeadlineAt.getTime() <= Date.now()) {
        outcome = { error: "time_up", status: 408 }
      } else if (!admitted.inserted) {
        const existing = await prisma.response.findFirst({
          where: { sessionId, slideId, nickname: { equals: nickname, mode: "insensitive" } },
          select: { nickname: true, answer: true, points: true },
        })
        if (!existing) outcome = { error: "response_not_found", status: 404 }
        else {
          const recovered = scoreAnswer({ type, config, answer: existing.answer, elapsedSeconds: null, streak: 0 })
          outcome = {
            pending: true,
            alreadySubmitted: true,
            receipt: {
              version: 1,
              sessionId,
              slideId,
              nickname: existing.nickname ?? nickname,
              correct: recovered.correct,
              points: existing.points,
              streakBonus: 0,
            },
          }
        }
      } else {
        outcome = {
          pending: true,
          alreadySubmitted: false,
          receipt: {
            version: 1,
            sessionId,
            slideId,
            nickname,
            correct: scored.correct,
            points: admitted.awardedPoints,
            streakBonus: admitted.streakBonus,
          },
        }
      }
    }
  }

  if ("error" in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }
  if ("pending" in outcome) {
    const resultToken = sealQuizResultReceipt(outcome.receipt)
    return NextResponse.json({
      correct: null,
      points: 0,
      rank: null,
      streakBonus: 0,
      alreadySubmitted: outcome.alreadySubmitted,
      pendingReveal: true,
      ...(resultToken ? { resultToken } : {}),
    })
  }

  const rank = outcome.correct === null
    ? null
    : await participantRank(sessionId, outcome.nickname, outcome.points)
  return NextResponse.json({ ...outcome, rank })
}
