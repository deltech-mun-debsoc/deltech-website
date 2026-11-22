"use server"

import { AuthError } from "next-auth"
import { signIn } from "@/lib/auth"
import { isAuthRateLimitError } from "@/lib/auth-errors"
import { prisma } from "@/lib/prisma"
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export type StartWritingState = { error?: "name" | "email" | "rate" | "default" } | null

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function startWriting(_prev: StartWritingState, formData: FormData): Promise<StartWritingState> {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 80)
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  if (!name) return { error: "name" }
  if (!EMAIL.test(email) || email.length > 254) return { error: "email" }

  const limit = await rateLimit(RATE_LIMITS.signup, email)
  if (!limit.ok) return { error: "rate" }

  const existing = await prisma.user.findUnique({ where: { email }, select: { name: true, disabledAt: true } })
  if (existing?.disabledAt) return { error: "default" }
  if (!existing) {
    try {
      await prisma.user.create({ data: { email, name, role: "AUTHOR" } })
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") throw err
    }
  } else if (!existing.name) {
    await prisma.user.update({ where: { email }, data: { name } })
  }

  try {
    await signIn("resend", { email, redirectTo: "/blog/write" })
    return null
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw err
    if (isAuthRateLimitError(err)) return { error: "rate" }
    if (err instanceof AuthError) return { error: "default" }
    return { error: "default" }
  }
}
