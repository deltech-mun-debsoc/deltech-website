import { createHmac, timingSafeEqual } from "node:crypto"

// Unsubscribe tokens for the PR outreach list.
//
// The token is the contact id plus an HMAC of it, so the link works without a
// login (it has to: the person clicking it is not a user) and cannot be forged
// to unsubscribe somebody else. Pure, with the secret passed in, so
// scripts/check-mailer.ts can pin it without the environment.

function mac(contactId: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${contactId}`).digest("base64url")
}

export function signUnsubscribeToken(contactId: string, secret: string): string {
  if (!secret) throw new Error("An unsubscribe secret is required.")
  return `${contactId}.${mac(contactId, secret)}`
}

export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (!secret || typeof token !== "string") return null
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null
  const contactId = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(mac(contactId, secret))
  // Length first: timingSafeEqual throws on unequal lengths.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return contactId
}
