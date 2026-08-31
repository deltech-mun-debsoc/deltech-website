import "dotenv/config"

import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"
import { prisma } from "../src/lib/prisma"

const baseUrl = (process.env.QUIZ_LOAD_BASE_URL ?? "https://www.deltechmun.in").replace(/\/$/, "")
const participantCount = Number(process.env.QUIZ_LOAD_PARTICIPANTS ?? "150")
const rampMs = Number(process.env.QUIZ_LOAD_RAMP_MS ?? "0")
const keepFixture = process.env.QUIZ_LOAD_KEEP_FIXTURE === "1"

if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 500) {
  throw new Error("QUIZ_LOAD_PARTICIPANTS must be an integer from 1 to 500")
}
if (!Number.isFinite(rampMs) || rampMs < 0 || rampMs > 60_000) {
  throw new Error("QUIZ_LOAD_RAMP_MS must be from 0 to 60000")
}

const nonce = randomUUID().replaceAll("-", "").slice(0, 18)
const presentationId = `load_p_${nonce}`
const slideId = `load_s_${nonce}`
const sessionId = `load_q_${nonce}`
const roomCode = String(100_000 + Math.floor(Math.random() * 900_000))

function percentile(sorted: number[], percentileValue: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1)]
}

type RequestResult = { status: number; error: string | null; elapsedMs: number; resultToken?: string }

function summarize(results: RequestResult[], wallMs: number) {
  const latencies = results.map((result) => result.elapsedMs).sort((a, b) => a - b)
  return {
    wallMs: Math.round(wallMs),
    requestsPerSecond: Number((results.length / (wallMs / 1000)).toFixed(1)),
    latencyMs: {
      min: Math.round(latencies[0] ?? 0),
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      p99: Math.round(percentile(latencies, 99)),
      max: Math.round(latencies.at(-1) ?? 0),
    },
    statuses: Object.fromEntries(
      [...new Set(results.map((result) => result.status))]
        .sort((a, b) => a - b)
        .map((status) => [String(status), results.filter((result) => result.status === status).length]),
    ),
    errors: Object.fromEntries(
      [...new Set(results.map((result) => result.error).filter(Boolean))]
        .sort()
        .map((error) => [String(error), results.filter((result) => result.error === error).length]),
    ),
  }
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function cleanup() {
  await prisma.$transaction([
    prisma.response.deleteMany({ where: { sessionId } }),
    prisma.rateLimit.deleteMany({ where: { key: { startsWith: `quizanswer:${sessionId}:` } } }),
    prisma.quizSession.deleteMany({ where: { id: sessionId } }),
    prisma.slide.deleteMany({ where: { id: slideId } }),
    prisma.presentation.deleteMany({ where: { id: presentationId } }),
  ])
}

async function main() {
try {
  await prisma.presentation.create({
    data: {
      id: presentationId,
      ownerId: "quiz-load-test",
      title: `QUIZ LOAD TEST ${nonce}`,
      mode: "QUIZ",
    },
  })
  await prisma.slide.create({
    data: {
      id: slideId,
      presentationId,
      order: 0,
      type: "MCQ",
      prompt: "Load test: which option is correct?",
      config: {
        options: ["This one", "Definitely not", "Maybe the other one", "None of these"],
        correct: [0],
        allowMultiple: false,
        partialCredit: false,
        basePoints: 1000,
        speedWeight: 0.5,
        streakBonus: 50,
        timerSeconds: 120,
      },
    },
  })
  const startedAt = new Date()
  await prisma.quizSession.create({
    data: {
      id: sessionId,
      presentationId,
      roomCode,
      status: "active",
      currentSlideId: slideId,
      currentSlideStartedAt: startedAt,
      currentSlideDeadlineAt: new Date(startedAt.getTime() + 120_000),
    },
  })

  const wallStartedAt = performance.now()
  const results = await Promise.all(
    Array.from({ length: participantCount }, async (_, index) => {
      if (rampMs > 0 && participantCount > 1) await delay((index / (participantCount - 1)) * rampMs)
      const started = performance.now()
      try {
        const response = await fetch(`${baseUrl}/api/quiz/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            slideId,
            nickname: `load-${nonce.slice(0, 8)}-${String(index + 1).padStart(3, "0")}`,
            avatar: "🧪",
            answer: { selectedIndices: [index % 4 === 0 ? 1 : 0] },
          }),
        })
        const body = await response.json().catch(() => null) as { error?: string; resultToken?: string } | null
        return {
          status: response.status,
          error: body?.error ?? null,
          elapsedMs: performance.now() - started,
          resultToken: body?.resultToken,
        }
      } catch (error) {
        return {
          status: 0,
          error: error instanceof Error ? error.message : "transport_error",
          elapsedMs: performance.now() - started,
        }
      }
    }),
  )
  const wallMs = performance.now() - wallStartedAt
  const stored = await prisma.response.count({ where: { sessionId } })

  const pollStartedAt = performance.now()
  const pollResults = await Promise.all(
    Array.from({ length: participantCount }, async () => {
      const started = performance.now()
      try {
        const response = await fetch(`${baseUrl}/api/quiz/sessions?sessionId=${sessionId}`)
        const body = await response.json().catch(() => null) as { error?: string } | null
        return { status: response.status, error: body?.error ?? null, elapsedMs: performance.now() - started }
      } catch (error) {
        return {
          status: 0,
          error: error instanceof Error ? error.message : "transport_error",
          elapsedMs: performance.now() - started,
        }
      }
    }),
  )
  const pollWallMs = performance.now() - pollStartedAt

  console.log(JSON.stringify({
    baseUrl,
    participants: participantCount,
    rampMs,
    answers: summarize(results, wallMs),
    recoveryPoll: summarize(pollResults, pollWallMs),
    encryptedReceipts: results.filter((result) => result.resultToken).length,
    stored,
    fixture: keepFixture ? { presentationId, slideId, sessionId, roomCode } : undefined,
  }, null, 2))
} finally {
  if (!keepFixture) await cleanup()
  await prisma.$disconnect()
}
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
