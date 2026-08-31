import { prisma } from "@/lib/prisma"

// Fixed-window counter, backed by the database.
//
// Nothing in the app was rate limited: signInWithPassword allowed unlimited
// guesses against an 8-character-minimum password with no lockout,
// requestMagicLink would mail any address as often as asked (burning the
// Resend quota and making the app a spam relay), and the quiz endpoints were
// wide open behind a 6-digit room code.
//
// DB-backed rather than in-memory because serverless instances do not share
// memory: a Map would reset on every cold start and only ever throttle one
// instance. One indexed upsert per protected call, which at this traffic is
// free. No new dependency and no new service.
//
// ponytail: fixed window, so a burst can straddle a boundary and get up to 2x
// the limit. That is fine for the abuse this is stopping; move to a sliding
// window or Redis if a determined attacker ever makes it worth it.

export interface RateLimitRule {
  /** Distinct bucket name, e.g. "signin". Keeps limits from colliding. */
  name: string
  limit: number
  windowMs: number
}

export const RATE_LIMITS = {
  // Credential stuffing. Deliberately the tightest.
  signIn: { name: "signin", limit: 10, windowMs: 10 * 60_000 },
  // Mail bombing an address, and Resend quota burn.
  magicLink: { name: "magiclink", limit: 5, windowMs: 15 * 60_000 },
  signup: { name: "signup", limit: 5, windowMs: 60 * 60_000 },
  register: { name: "register", limit: 10, windowMs: 60 * 60_000 },
  // Enumerating live sessions across a 6-digit (900k) code space.
  quizLookup: { name: "quizlookup", limit: 30, windowMs: 60_000 },
  // Per participant, not per venue IP. A college quiz commonly has everyone
  // behind one NAT address; sharing this bucket made the 61st phone an abuser.
  quizAnswer: { name: "quizanswer", limit: 8, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>

export interface RateLimitResult {
  ok: boolean
  /** Seconds until the window resets. Only meaningful when ok is false. */
  retryAfter: number
}

/**
 * Consume one unit against `identifier` (an email, an IP, a room code).
 *
 * Fails **open**: if the database is unreachable this returns ok, because a
 * rate limiter that takes sign-in down with it is worse than no rate limiter.
 * The abuse it stops is noisy and repeated; a brief gap does not matter.
 */
export async function rateLimit(
  rule: RateLimitRule,
  identifier: string,
): Promise<RateLimitResult> {
  const key = `${rule.name}:${identifier.trim().toLowerCase()}`
  const now = new Date()
  const windowStart = new Date(now.getTime() - rule.windowMs)

  try {
    // One atomic round trip. The old update -> upsert -> read sequence tripled
    // database work and, for a shared quiz IP, queued the entire room behind
    // one locked row. RETURNING gives this request its own incremented count.
    const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "windowStart")
      VALUES (${key}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."windowStart" <= ${windowStart} THEN 1
          ELSE "RateLimit"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimit"."windowStart" <= ${windowStart} THEN ${now}
          ELSE "RateLimit"."windowStart"
        END
      RETURNING "count", "windowStart"
    `
    const row = rows[0]
    if (!row) return { ok: true, retryAfter: 0 }

    if (row.count > rule.limit) {
      const resetAt = row.windowStart.getTime() + rule.windowMs
      return { ok: false, retryAfter: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)) }
    }
    return { ok: true, retryAfter: 0 }
  } catch {
    return { ok: true, retryAfter: 0 }
  }
}

/** Best-effort cleanup of windows that expired long ago. Never throws. */
export async function pruneRateLimits(olderThanMs = 24 * 60 * 60_000): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({
      where: { windowStart: { lt: new Date(Date.now() - olderThanMs) } },
    })
  } catch {
    // Housekeeping only.
  }
}
