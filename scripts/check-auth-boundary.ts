#!/usr/bin/env tsx
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { AuthRateLimitError } from "../src/lib/auth-errors"

const source = readFileSync("src/lib/auth.ts", "utf8")
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
})

let config: any
let limitOk = true
let user: any = null
let passwordValid = true
let passwordClears = 0
const prisma = {
  user: {
    findUnique: async () => user,
    updateMany: async () => { passwordClears++; return { count: 1 } },
  },
}

const module = { exports: {} as Record<string, unknown> }
runInNewContext(outputText, {
  module,
  exports: module.exports,
  console,
  process,
  Date,
  require: (name: string) => {
    const dependencies: Record<string, unknown> = {
      "next-auth": { __esModule: true, default: (value: unknown) => {
        config = value
        return { handlers: {}, auth: () => null, signIn: () => null, signOut: () => null }
      } },
      "@auth/prisma-adapter": { PrismaAdapter: () => ({}) },
      "next-auth/providers/resend": { __esModule: true, default: (value: object) => ({ id: "resend", ...value }) },
      "next-auth/providers/credentials": { __esModule: true, default: (value: object) => ({ id: "credentials", ...value }) },
      "@/lib/prisma": { prisma },
      "@/lib/auth.config": { authConfig: { callbacks: {} } },
      "@/lib/password": { verifyPassword: async () => passwordValid },
      "@/lib/user-admin": { sessionNeedsRefresh: () => true },
      "@/lib/rate-limit": {
        RATE_LIMITS: { signIn: {}, magicLink: {} },
        rateLimit: async () => ({ ok: limitOk, retryAfter: limitOk ? 0 : 60 }),
      },
      "@/lib/auth-errors": { AuthRateLimitError },
      "@/lib/magic-link": { MAGIC_LINK_MAX_AGE_S: 1800 },
    }
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
    return dependencies[name]
  },
})

async function main() {
  const credentials = config.providers.find((provider: any) => provider.id === "credentials")
  const callbacks = config.callbacks

  user = { id: "u1", email: "person@example.com", role: "REGISTERER", passwordHash: "hash", emailVerified: null, disabledAt: null }
  assert.equal(await credentials.authorize({ email: user.email, password: "correct" }), null,
    "knowing an unverified account's password must not prove email ownership")

  user.emailVerified = new Date()
  assert.equal((await credentials.authorize({ email: user.email, password: "correct" }))?.id, "u1")
  passwordValid = false
  assert.equal(await credentials.authorize({ email: user.email, password: "wrong" }), null)
  passwordValid = true

  limitOk = false
  await assert.rejects(
    credentials.authorize({ email: user.email, password: "correct" }),
    (error: unknown) => error instanceof AuthRateLimitError,
    "the provider itself must throttle direct Auth.js requests",
  )
  await assert.rejects(
    callbacks.signIn({ user, email: { verificationRequest: true }, account: { provider: "resend" } }),
    (error: unknown) => error instanceof AuthRateLimitError,
    "direct magic-link requests must be throttled at the provider",
  )

  limitOk = true
  user.emailVerified = null
  passwordClears = 0
  assert.equal(await callbacks.signIn({ user, account: { provider: "resend" } }), true)
  assert.equal(passwordClears, 1, "mailbox proof must erase a password claimed before verification")

  assert.equal(await callbacks.jwt({ token: { sub: "u1" } }), null,
    "a legacy unverified session must not continue exposing email-linked records")
  user.emailVerified = new Date()
  assert.equal((await callbacks.jwt({ token: { sub: "u1" } })).verifiedIdentity, true)

  console.log("auth boundary checks passed (direct throttling, verification, pre-hijack cleanup, legacy sessions)")
}

main().catch((error) => { console.error(error); process.exit(1) })
