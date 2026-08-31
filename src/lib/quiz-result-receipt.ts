import { createCipheriv, createHash, randomBytes } from "node:crypto"

export type QuizResultReceipt = {
  version: 1
  sessionId: string
  slideId: string
  nickname: string
  correct: boolean | null
  points: number
  streakBonus: number
}

function receiptKey(sessionId: string, slideId: string): Buffer | null {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) return null
  return createHash("sha256")
    .update("quiz-result-receipt:v1\0")
    .update(secret)
    .update("\0")
    .update(sessionId)
    .update("\0")
    .update(slideId)
    .digest()
}

export function quizResultRevealKey(sessionId: string, slideId: string): string | null {
  return receiptKey(sessionId, slideId)?.toString("base64url") ?? null
}

// The phone receives this opaque receipt with its initial answer. It cannot
// inspect correctness early. Once the host reveals, the broadcast supplies the
// per-slide key and every phone opens its own receipt locally: zero reveal-time
// database fan-out, with the server's original score preserved exactly.
export function sealQuizResultReceipt(payload: QuizResultReceipt): string | null {
  const key = receiptKey(payload.sessionId, payload.slideId)
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(`${payload.sessionId}:${payload.slideId}`))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`
}
