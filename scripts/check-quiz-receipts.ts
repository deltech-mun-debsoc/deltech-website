import assert from "node:assert/strict"
import { createDecipheriv } from "node:crypto"
import { quizResultRevealKey, sealQuizResultReceipt } from "../src/lib/quiz-result-receipt"

const previousSecret = process.env.AUTH_SECRET
process.env.AUTH_SECRET = "quiz-receipt-test-secret"

try {
  const payload = {
    version: 1 as const,
    sessionId: "session-test",
    slideId: "slide-test",
    nickname: "Player One",
    correct: true,
    points: 875,
    streakBonus: 50,
  }
  const token = sealQuizResultReceipt(payload)
  const resultKey = quizResultRevealKey(payload.sessionId, payload.slideId)
  assert.ok(token && resultKey, "configured deployments must produce a result receipt and reveal key")
  assert.doesNotMatch(token, /Player One|875|true/, "the pre-reveal receipt must be opaque")

  const [version, encodedIv, encodedCiphertext, encodedTag] = token.split(".")
  assert.equal(version, "v1")
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(resultKey, "base64url"),
    Buffer.from(encodedIv, "base64url"),
  )
  decipher.setAAD(Buffer.from(`${payload.sessionId}:${payload.slideId}`))
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ])
  assert.deepEqual(JSON.parse(plaintext.toString("utf8")), payload)

  console.log("quiz receipt checks passed (opaque before reveal, exact after reveal)")
} finally {
  if (previousSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = previousSecret
}
