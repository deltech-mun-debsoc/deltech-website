import { randomUUID } from "node:crypto"
import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"

export type QuizAnswerAdmissionInput = {
  sessionId: string
  slideId: string
  nickname: string
  avatar: string | null
  answer: unknown
  basePoints: number
  streakStep: number
}

export type QuizAnswerAdmission = {
  status: string | null
  currentSlideId: string | null
  currentSlideStartedAt: Date | null
  currentSlideDeadlineAt: Date | null
  currentSlideLockedAt: Date | null
  currentSlideRevealedAt: Date | null
  inserted: boolean
  awardedPoints: number
  streakBonus: number
}

type PendingAnswer = QuizAnswerAdmissionInput & {
  requestId: string
  responseId: string
  resolve: (result: QuizAnswerAdmission) => void
  reject: (error: unknown) => void
}

type AnswerQueue = {
  items: PendingAnswer[]
  timer: ReturnType<typeof setTimeout> | null
}

const globalForQuizAnswers = globalThis as unknown as {
  quizAnswerQueues?: Map<string, AnswerQueue>
}

const queues = globalForQuizAnswers.quizAnswerQueues ?? new Map<string, AnswerQueue>()
globalForQuizAnswers.quizAnswerQueues = queues

async function executeBatch(items: PendingAnswer[]): Promise<void> {
  const values = items.map((item) => Prisma.sql`(
    ${item.requestId}, ${item.responseId}, ${item.nickname}, ${item.avatar},
    ${JSON.stringify(item.answer)}::jsonb, ${item.basePoints}::int, ${item.streakStep}::int
  )`)
  const first = items[0]

  try {
    const rows = await prisma.$queryRaw<(QuizAnswerAdmission & { requestId: string })[]>(Prisma.sql`
      WITH input("requestId", "responseId", "nickname", "avatar", "answer", "basePoints", "streakStep") AS (
        VALUES ${Prisma.join(values)}
      ), live AS MATERIALIZED (
        SELECT "status", "currentSlideId", "currentSlideStartedAt", "currentSlideDeadlineAt",
               "currentSlideLockedAt", "currentSlideRevealedAt"
        FROM "QuizSession"
        WHERE "id" = ${first.sessionId}
        FOR SHARE
      ), scored AS (
        SELECT input.*,
          input."basePoints" + (input."streakStep" * LEAST(5, COALESCE(streak."count", 0)))::int AS "awardedPoints",
          (input."streakStep" * LEAST(5, COALESCE(streak."count", 0)))::int AS "streakBonus"
        FROM input
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "count"
          FROM (
            SELECT BOOL_AND(recent."points" > 0) OVER (
              ORDER BY recent."createdAt" DESC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS leading_correct
            FROM (
              SELECT "points", "createdAt"
              FROM "Response"
              WHERE "sessionId" = ${first.sessionId}
                AND LOWER("nickname") = LOWER(input."nickname")
              ORDER BY "createdAt" DESC
              LIMIT 5
            ) recent
          ) history
          WHERE leading_correct
        ) streak ON TRUE
      ), inserted AS (
        INSERT INTO "Response" ("id", "sessionId", "slideId", "nickname", "avatar", "answer", "points", "createdAt")
        SELECT scored."responseId", ${first.sessionId}, ${first.slideId}, scored."nickname", scored."avatar",
               scored."answer", scored."awardedPoints", NOW()
        FROM scored CROSS JOIN live
        WHERE live."status" = 'active'
          AND live."currentSlideId" = ${first.slideId}
          AND live."currentSlideLockedAt" IS NULL
          AND live."currentSlideRevealedAt" IS NULL
          AND (live."currentSlideDeadlineAt" IS NULL OR live."currentSlideDeadlineAt" > NOW())
          AND (SELECT COUNT(*) FROM "Response" cap
               WHERE cap."sessionId" = ${first.sessionId} AND cap."slideId" = ${first.slideId}) < 500
        ON CONFLICT DO NOTHING
        RETURNING "id", "points"
      )
      SELECT input."requestId", live."status", live."currentSlideId", live."currentSlideStartedAt",
             live."currentSlideDeadlineAt", live."currentSlideLockedAt", live."currentSlideRevealedAt",
             EXISTS (SELECT 1 FROM inserted WHERE inserted."id" = input."responseId") AS "inserted",
             COALESCE(scored."awardedPoints", 0)::int AS "awardedPoints",
             COALESCE(scored."streakBonus", 0)::int AS "streakBonus"
      FROM input
      LEFT JOIN live ON TRUE
      LEFT JOIN scored ON scored."requestId" = input."requestId"
    `)
    const byRequest = new Map(rows.map((row) => [row.requestId, row]))
    for (const item of items) {
      item.resolve(byRequest.get(item.requestId) ?? {
        status: null,
        currentSlideId: null,
        currentSlideStartedAt: null,
        currentSlideDeadlineAt: null,
        currentSlideLockedAt: null,
        currentSlideRevealedAt: null,
        inserted: false,
        awardedPoints: 0,
        streakBonus: 0,
      })
    }
  } catch (error) {
    for (const item of items) item.reject(error)
  }
}

function flush(key: string, queue: AnswerQueue) {
  if (queues.get(key) !== queue) return
  queues.delete(key)
  if (queue.timer) clearTimeout(queue.timer)
  void executeBatch(queue.items)
}

export function admitQuizAnswer(input: QuizAnswerAdmissionInput): Promise<QuizAnswerAdmission> {
  const key = `${input.sessionId}:${input.slideId}`
  let queue = queues.get(key)
  if (!queue) {
    queue = { items: [], timer: null }
    queues.set(key, queue)
    // A short coalescing window turns a room-wide burst into a handful of SQL
    // statements. The 100ms ceiling is imperceptible beside the tap animation,
    // while being long enough to group requests across ordinary venue jitter.
    queue.timer = setTimeout(() => flush(key, queue!), 100)
  }

  return new Promise((resolve, reject) => {
    queue!.items.push({
      ...input,
      requestId: randomUUID(),
      responseId: randomUUID(),
      resolve,
      reject,
    })
    if (queue!.items.length >= 200) flush(key, queue!)
  })
}
