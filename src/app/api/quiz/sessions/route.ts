import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createOrGetQuizSession } from "@/lib/quiz-session"
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { parseConfig, redactSlide } from "@/lib/quiz-types"
import type { SlideType } from "@/lib/quiz-types"
import { correctAnswersForSlide, correctIndicesForSlide, secondsUntil, slideTimerSeconds } from "@/lib/quiz-live"
import { cachedLiveQuizSnapshot, liveQuizSnapshotByCode, type LiveQuizSnapshot } from "@/lib/quiz-cache"
import { quizResultRevealKey } from "@/lib/quiz-result-receipt"

// The live question, redacted, with the server's own count of the time left on
// it. Null when nothing is on screen yet.
function asDate(value: Date | string | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value)
}

function liveSlide(session: LiveQuizSnapshot) {
  if (!session.currentSlideId || !session.slideId || session.slideOrder === null || !session.slideType) return null

  const type = session.slideType as SlideType
  const fullSlide = {
    id: session.slideId,
    order: session.slideOrder,
    type,
    prompt: session.slidePrompt ?? "",
    config: parseConfig(session.slideConfig, type),
  }
  const slide = redactSlide(fullSlide)

  // Remaining time from the SERVER's record of when the slide went live, not
  // from anything the phone believes, so a phone rejoining picks up the same
  // deadline everyone else is on.
  const timer = slideTimerSeconds(fullSlide)
  const deadline = asDate(session.currentSlideDeadlineAt)
  const lockedAt = asDate(session.currentSlideLockedAt)
  const startedAt = asDate(session.currentSlideStartedAt)
  const secondsLeft = deadline
    ? secondsUntil(deadline, lockedAt ?? new Date())
    : timer !== null && startedAt
      ? Math.max(0, timer - (Date.now() - startedAt.getTime()) / 1000)
      : null

  const revealed = session.currentSlideRevealedAt !== null

  return {
    slide,
    slideIndex: session.slideOrder,
    slideCount: session.slideCount,
    secondsLeft,
    // A timer reaching zero closes voting even if the presenter's browser was
    // asleep and never got a chance to persist the automatic lock yet.
    locked: session.currentSlideLockedAt !== null || (timer !== null && secondsLeft === 0),
    revealed,
    correctIndices: revealed ? correctIndicesForSlide(fullSlide) : [],
    correctAnswers: revealed ? correctAnswersForSlide(fullSlide) : [],
    resultKey: revealed ? quizResultRevealKey(session.id, session.slideId) : null,
  }
}

// GET ?code=123456 , participant lookup (public)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const sessionId = searchParams.get("sessionId")
  if (!code && !sessionId) return NextResponse.json({ error: "code or sessionId required" }, { status: 400 })

  // Unauthenticated oracle over a 6-digit (900k) space, without a throttle,
  // live sessions can be enumerated and then targeted.
  if (!sessionId) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const limit = await rateLimit(RATE_LIMITS.quizLookup, ip)
    if (!limit.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      )
    }
  }

  // A CUID is unguessable and comes from the already-rendered participant page,
  // so connected phones can cheaply reconcile state without consuming the
  // six-digit room-code enumeration budget every five seconds.
  const session = sessionId
    ? await cachedLiveQuizSnapshot(sessionId)
    : await liveQuizSnapshotByCode(code!)
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 })

  // Which question is live, and how long is left on it.
  //
  // The room is driven by realtime broadcasts, which are fire-and-forget: a
  // phone that slept through a GOTO, dropped its socket in a corridor, or joined
  // after the question went up simply never heard it, and sat on a stale screen
  // for the rest of the quiz with no way back. This is the recovery path, and it
  // doubles as the answer for latecomers.
  //
  // The slide goes out redacted, exactly as the broadcast does.
  const live = liveSlide(session)

  return NextResponse.json({
    session: {
      id: session.id,
      roomCode: session.roomCode,
      status: session.status,
      presentationId: session.presentationId,
    },
    presentationMode: session.presentationMode ?? "POLL",
    live,
  })
}

// POST , admin creates a session
export async function POST(request: Request) {
  const authSession = await auth()
  const role = (authSession?.user as { role?: string } | undefined)?.role
  if (!authSession || (role !== "ADMIN" && role !== "MAINTAINER")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { presentationId } = (await request.json()) as { presentationId: string }

  const session = await createOrGetQuizSession(presentationId)
  return NextResponse.json(session, { status: 201 })
}
