import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { createOrGetQuizSession } from "@/lib/quiz-session"
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { parseConfig, redactSlide } from "@/lib/quiz-types"
import type { SlideType } from "@/lib/quiz-types"

// The live question, redacted, with the server's own count of the time left on
// it. Null when nothing is on screen yet.
async function liveSlide(session: {
  presentationId: string
  currentSlideId: string | null
  currentSlideStartedAt: Date | null
}) {
  if (!session.currentSlideId) return null

  const [row, slideCount] = await Promise.all([
    prisma.slide.findUnique({
      where: { id: session.currentSlideId },
      select: { id: true, order: true, type: true, prompt: true, config: true },
    }),
    prisma.slide.count({ where: { presentationId: session.presentationId } }),
  ])
  if (!row) return null

  const type = row.type as SlideType
  const slide = redactSlide({
    id: row.id,
    order: row.order,
    type,
    prompt: row.prompt,
    config: parseConfig(row.config, type),
  })

  // Remaining time from the SERVER's record of when the slide went live, not
  // from anything the phone believes, so a phone rejoining picks up the same
  // deadline everyone else is on.
  const timer = (slide.config as { timerSeconds?: number | null }).timerSeconds
  const secondsLeft =
    typeof timer === "number" && timer > 0 && session.currentSlideStartedAt
      ? Math.max(0, timer - (Date.now() - session.currentSlideStartedAt.getTime()) / 1000)
      : null

  return { slide, slideIndex: row.order, slideCount, secondsLeft }
}

// GET ?code=123456 , participant lookup (public)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 })

  // Unauthenticated oracle over a 6-digit (900k) space, without a throttle,
  // live sessions can be enumerated and then targeted.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const limit = await rateLimit(RATE_LIMITS.quizLookup, ip)
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    )
  }

  const session = await prisma.quizSession.findFirst({
    where: { roomCode: code },
    select: {
      id: true,
      roomCode: true,
      status: true,
      presentationId: true,
      currentSlideId: true,
      currentSlideStartedAt: true,
    },
  })
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const presentation = await prisma.presentation.findUnique({
    where: { id: session.presentationId },
    select: { mode: true, title: true },
  })

  // Which question is live, and how long is left on it.
  //
  // The room is driven by realtime broadcasts, which are fire-and-forget: a
  // phone that slept through a GOTO, dropped its socket in a corridor, or joined
  // after the question went up simply never heard it, and sat on a stale screen
  // for the rest of the quiz with no way back. This is the recovery path, and it
  // doubles as the answer for latecomers.
  //
  // The slide goes out redacted, exactly as the broadcast does.
  const live = await liveSlide(session)

  return NextResponse.json({
    session: {
      id: session.id,
      roomCode: session.roomCode,
      status: session.status,
      presentationId: session.presentationId,
    },
    presentationMode: presentation?.mode ?? "POLL",
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
