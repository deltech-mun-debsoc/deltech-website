import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPaymentReminder } from "@/lib/resend"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"

// Called daily at 03:00 UTC (vercel.json on Vercel, .github/workflows/cron.yml
// on AWS). Finds allotted delegates with unpaid payments, skips those reminded
// in the last 24 h, and caps sends at 80/run (Resend free-tier headroom; SES
// allows far more, but a runaway reminder loop should stay small either way).

const DAILY_CAP = 80

// How many sends run at once. Strictly sequential, 80 sends at ~400ms of
// Resend round-trip each is ~32s of pure latency, which pushed the function
// near its timeout and kept the overlap window below wide open.
const CONCURRENCY = 8

// Run lock. The dedupe predicate reads EmailLog, but loggedSend only writes
// that row *after* Resend returns, so a retried or manually-triggered second
// invocation re-selected the same delegates and mailed them twice. This makes
// the run itself exclusive.
const LOCK_KEY = "paymentReminderRunAt"
const LOCK_TTL_MS = 10 * 60 * 1000

async function claimRun(): Promise<boolean> {
  const now = new Date()
  try {
    return await prisma.$transaction(
      async (tx) => {
        const existing = await tx.setting.findUnique({ where: { key: LOCK_KEY } })
        const last = existing ? new Date(String(existing.value)) : null
        if (last && !Number.isNaN(last.getTime()) && now.getTime() - last.getTime() < LOCK_TTL_MS) {
          return false
        }
        await tx.setting.upsert({
          where: { key: LOCK_KEY },
          create: { key: LOCK_KEY, value: now.toISOString() },
          update: { value: now.toISOString() },
        })
        return true
      },
      { isolationLevel: "Serializable" },
    )
  } catch {
    // Serialization failure means another invocation claimed it first.
    return false
  }
}

export async function GET(req: NextRequest) {
  // Protect: only the CRON_SECRET bearer. Fail closed, an unset secret must
  // not leave this email-sending endpoint world-callable.
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const content = await getContent()
  if (!deriveEventState(content).paymentsRequired) {
    return NextResponse.json({ sent: 0, failed: 0, total: 0, disabled: true })
  }

  if (!(await claimRun())) {
    return NextResponse.json({ sent: 0, failed: 0, total: 0, skipped: "already running" })
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // Delegates with ALLOTTED / PAYMENT_SENT status that have a payment in non-final state
  // and have NOT been sent a payment-reminder in the last 24 h.
  const candidates = await prisma.delegate.findMany({
    where: {
      status: { in: ["ALLOTTED", "PAYMENT_SENT"] },
      payment: {
        status: { in: ["PENDING", "SENT", "FAILED"] },
      },
      NOT: {
        emailLogs: {
          some: {
            template: "payment-reminder",
            // Deliberately not filtered to status: "SENT". A FAILED row is
            // still an attempt, and only counting successes meant a
            // permanently bouncing address was retried on every single run
            // while occupying one of the 80 daily slots.
            sentAt: { gte: since24h },
          },
        },
      },
    },
    select: { id: true },
    take: DAILY_CAP,
  })

  let sent = 0
  let failed = 0

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(batch.map(({ id }) => sendPaymentReminder(id)))
    for (const r of results) {
      if (r.status === "fulfilled") sent++
      else failed++
    }
  }

  return NextResponse.json({ sent, failed, total: candidates.length })
}
