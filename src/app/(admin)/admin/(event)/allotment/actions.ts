"use server"

import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { requireStaff, requireAdmin } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { getActiveProvider } from "@/lib/payments"
import { sendAllotmentEmail, sendCoDelegateNotice } from "@/lib/resend"
import { syncSheetCell, syncSheetForDelegate } from "@/lib/sheet-sync"
import { getContent } from "@/lib/settings"
import { deriveEventState } from "@/lib/event-state"

function isPrismaP2002(err: unknown): boolean {
  // Prisma unique constraint violation
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  )
}

// ── holdPortfolio ──────────────────────────────────────────────────────────────
// Soft-locks a portfolio to ON_HOLD while the dialog is open.
// Only transitions AVAILABLE → ON_HOLD (ignores if already ON_HOLD or ALLOTTED).
// Returns whether *this* caller took the hold. It used to discard the
// updateMany count and always report success, so the dialog's `heldByUs` was
// always true, so `onHoldByOther` was always false and the "on hold by another
// admin" warning could never render. The soft-lock existed but never fired.
export async function holdPortfolio(
  portfolioId: string,
): Promise<{ success: boolean; holdToken?: string; holdExpiresAt?: string }> {
  await requireStaff()
  const now = new Date()
  const holdToken = randomUUID()
  const holdExpiresAt = new Date(now.getTime() + 2 * 60 * 1000)
  const { count } = await prisma.portfolio.updateMany({
    where: {
      id: portfolioId,
      OR: [
        { status: "AVAILABLE" },
        { status: "ON_HOLD", holdExpiresAt: { lt: now } },
      ],
    },
    data: { status: "ON_HOLD", holdToken, holdExpiresAt },
  })
  // The expiry goes back to the dialog so it can count down against the server's
  // clock rather than starting its own two minutes a round trip later.
  return count === 1
    ? { success: true, holdToken, holdExpiresAt: holdExpiresAt.toISOString() }
    : { success: false }
}

// ── releaseHold ────────────────────────────────────────────────────────────────
// Releases ON_HOLD back to AVAILABLE (called when dialog closes without confirming).
export async function releaseHold(portfolioId: string, holdToken: string): Promise<void> {
  await requireStaff()
  await prisma.portfolio.updateMany({
    where: { id: portfolioId, status: "ON_HOLD", holdToken },
    data: { status: "AVAILABLE", holdToken: null, holdExpiresAt: null },
  })
}

// ── allotPortfolio ─────────────────────────────────────────────────────────────
// Runs in a Prisma interactive transaction. Race-safe: the unique constraint on
// Allotment.portfolioId is the hard guard, if two admins confirm simultaneously,
// one hits P2002 and their transaction rolls back cleanly.
export async function allotPortfolio(input: {
  portfolioId: string
  committeeId: string
  delegateId: string
  holdToken: string
}): Promise<{
  success: boolean
  error?: string
  warning?: string
  code?: "ALREADY_ALLOTTED" | "DELEGATE_UNAVAILABLE" | "HOLD_LOST" | "FEE_MISSING"
}> {
  const session = await requireStaff()
  const adminEmail = session.user?.email ?? "admin"
  const content = await getContent()
  const paymentsEnabled = deriveEventState(content).paymentsRequired

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Re-check portfolio has not already been allotted inside the transaction
      const portfolio = await tx.portfolio.findUnique({
        where: { id: input.portfolioId },
        select: { status: true, committeeId: true, holdToken: true, holdExpiresAt: true },
      })
      if (!portfolio || portfolio.status === "ALLOTTED") {
        const e = new Error("Already allotted") as Error & { code: string }
        e.code = "ALREADY_ALLOTTED"
        throw e
      }
      if (
        portfolio.committeeId !== input.committeeId ||
        portfolio.status !== "ON_HOLD" ||
        portfolio.holdToken !== input.holdToken ||
        !portfolio.holdExpiresAt ||
        portfolio.holdExpiresAt <= new Date()
      ) {
        const e = new Error("Hold lost") as Error & { code: string }
        e.code = "HOLD_LOST"
        throw e
      }

      // 2. Confirm delegate is still waiting. A draft allotment leaves them
      // REGISTERED, so the allotment row is what says they already have a seat.
      const delegate = await tx.delegate.findUnique({
        where: { id: input.delegateId },
        select: { isDtu: true, status: true, allotment: { select: { id: true } } },
      })
      if (!delegate || delegate.status !== "REGISTERED" || delegate.allotment) {
        const e = new Error("Delegate unavailable") as Error & { code: string }
        e.code = "DELEGATE_UNAVAILABLE"
        throw e
      }

      // 3. Committee type for fee lookup
      const committee = await tx.committee.findUnique({
        where: { id: input.committeeId },
        select: { type: true },
      })

      // 4. Fee lookup, amount always comes from the Fee table, never hardcoded
      const fee = paymentsEnabled ? await tx.fee.findFirst({
        where: {
          committeeType: committee?.type ?? "STANDARD",
          isDtu: delegate.isDtu,
        },
      }) : null
      if (paymentsEnabled && !fee) {
        const e = new Error("Fee missing") as Error & { code: string }
        e.code = "FEE_MISSING"
        throw e
      }

      // 5. Create Allotment, unique constraint on portfolioId is the final race guard.
      // A draft: the delegate stays REGISTERED and hears nothing until it is
      // emailed (emailAllotments), so seats can be reshuffled as people arrive.
      await tx.allotment.create({
        data: {
          delegateId: input.delegateId,
          committeeId: input.committeeId,
          portfolioId: input.portfolioId,
          allottedBy: adminEmail,
        },
      })

      // 6. Portfolio → ALLOTTED
      await tx.portfolio.update({
        where: { id: input.portfolioId },
        data: { status: "ALLOTTED", holdToken: null, holdExpiresAt: null },
      })
    })

    await audit(adminEmail, "allotment.create", "Delegate", input.delegateId, {
      portfolioId: input.portfolioId,
      committeeId: input.committeeId,
      paymentsEnabled,
    })
    await syncSheetForDelegate(input.delegateId)
    return { success: true }
  } catch (err: unknown) {
    // Hard race: unique constraint on portfolioId
    if (isPrismaP2002(err)) {
      return {
        success: false,
        error: "This portfolio was just allotted by another admin.",
        code: "ALREADY_ALLOTTED",
      }
    }
    // Soft checks thrown inside the transaction
    const e = err as { code?: string }
    if (e.code === "ALREADY_ALLOTTED") {
      return { success: false, error: "Portfolio is no longer available.", code: "ALREADY_ALLOTTED" }
    }
    if (e.code === "DELEGATE_UNAVAILABLE") {
      return {
        success: false,
        error: "This delegate has already been allotted.",
        code: "DELEGATE_UNAVAILABLE",
      }
    }
    if (e.code === "HOLD_LOST") {
      return {
        success: false,
        error: "Your hold expired or another organiser took this portfolio. Reopen it and try again.",
        code: "HOLD_LOST",
      }
    }
    if (e.code === "FEE_MISSING") {
      return {
        success: false,
        error: "Add the matching fee before allotting this paid event.",
        code: "FEE_MISSING",
      }
    }
    return { success: false, error: "Allotment failed. Please try again." }
  }
}

// ── emailAllotments ────────────────────────────────────────────────────────────
// Releases draft allotments: this is when the delegate is told. For a paid event
// it makes the payment row and link first, because that email exists to carry
// the link; a free event confirms them. Then the allotment email and, for a
// double delegation, the co-delegate notice.
//
// Each delegate is claimed by setting emailSentAt where it is still null, so two
// staff pressing Email at once cannot send twice or make two pay links. Any
// failure puts the claim back, leaving the allotment a draft to retry, and the
// delegate-facing pages show nothing until emailSentAt is set.
export async function emailAllotments(
  delegateIds: string[],
): Promise<{ sent: number; failed: { name: string; reason: string }[] }> {
  const session = await requireStaff()
  const adminEmail = session.user?.email ?? "admin"
  const paymentsEnabled = deriveEventState(await getContent()).paymentsRequired

  let sent = 0
  const failed: { name: string; reason: string }[] = []
  // Sequential on purpose: the mail transport is rate limited.
  for (const delegateId of delegateIds) {
    const claim = await prisma.allotment.updateMany({
      where: { delegateId, emailSentAt: null },
      data: { emailSentAt: new Date() },
    })
    if (claim.count === 0) continue

    const delegate = await prisma.delegate.findUnique({
      where: { id: delegateId },
      select: {
        fullName: true,
        status: true,
        isDtu: true,
        email: true,
        publicToken: true,
        allotment: { select: { committee: { select: { type: true } } } },
      },
    })
    try {
      if (!delegate?.allotment) throw new Error("No allotment")
      // Already confirmed (a cross delegation, or a retry after the email failed)
      // needs only the email.
      if (delegate.status === "REGISTERED") {
        if (paymentsEnabled) {
          const fee = await prisma.fee.findFirst({
            where: { committeeType: delegate.allotment.committee.type, isDtu: delegate.isDtu },
          })
          if (!fee) throw new Error("No fee set for this committee type")
          const providerSetting = await prisma.setting.findUnique({ where: { key: "paymentProvider" } })
          await prisma.payment.upsert({
            where: { delegateId },
            create: {
              delegateId,
              provider: typeof providerSetting?.value === "string" ? providerSetting.value : "upi_qr",
              amountInr: fee.amountInr,
              status: "PENDING",
            },
            update: {},
          })
          let payLinkFailed = false
          try {
            const { link, orderId } = await (await getActiveProvider()).createPaymentLink({
              delegateId,
              publicToken: delegate.publicToken,
              amountInr: fee.amountInr,
              email: delegate.email,
            })
            await prisma.payment.update({
              where: { delegateId },
              data: { paymentLink: link, status: "SENT", ...(orderId ? { razorpayOrderId: orderId } : {}) },
            })
          } catch (err) {
            payLinkFailed = true
            console.error("[emailAllotments] payment link generation failed", err)
          }
          if (payLinkFailed) throw new Error("Payment link could not be generated")
          await prisma.delegate.update({ where: { id: delegateId }, data: { status: "PAYMENT_SENT" } })
        } else {
          await prisma.delegate.update({ where: { id: delegateId }, data: { status: "CONFIRMED" } })
        }
      }
      await sendAllotmentEmail(delegateId, { force: true })
      await sendCoDelegateNotice(delegateId).catch(() => {})
      await audit(adminEmail, "allotment.email", "Delegate", delegateId)
      await syncSheetForDelegate(delegateId)
      sent++
    } catch (err) {
      await prisma.allotment.updateMany({ where: { delegateId }, data: { emailSentAt: null } })
      const message = err instanceof Error ? err.message : ""
      failed.push({
        name: delegate?.fullName ?? delegateId,
        reason: message.startsWith("Email send failed") ? "the email did not send, still a draft" : message || "failed, still a draft",
      })
    }
  }
  return { sent, failed }
}

// ── revokeAllotment ────────────────────────────────────────────────────────────
// Undoes an allotment: frees the portfolio, resets delegate to REGISTERED,
// and cancels any PENDING payment (does not touch PAID / SENT payments).
export async function revokeAllotment(input: {
  allotmentId: string
  portfolioId: string
  delegateId: string
}): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin()

  const cell = await prisma.portfolio.findUnique({
    where: { id: input.portfolioId },
    select: { name: true, committee: { select: { name: true } } },
  })

  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { delegateId: input.delegateId },
        select: { status: true },
      })
      // A draft's link was never delivered: the delegate only sees it once the
      // email has gone (emailAllotments sets emailSentAt last), so it can go.
      const allotment = await tx.allotment.findUnique({ where: { id: input.allotmentId }, select: { emailSentAt: true } })
      const draft = !allotment?.emailSentAt
      if (payment?.status === "SENT" && !draft) throw new Error("LIVE_PAYMENT_LINK")
      if (payment && ["PAID", "OFFLINE", "COMPED"].includes(payment.status)) {
        throw new Error("PAYMENT_FINAL")
      }
      await tx.allotment.delete({ where: { id: input.allotmentId } })

      await tx.portfolio.update({
        where: { id: input.portfolioId },
        data: { status: "AVAILABLE" },
      })

      await tx.delegate.update({
        where: { id: input.delegateId },
        data: { status: "REGISTERED" },
      })

      await tx.payment.deleteMany({
        where: { delegateId: input.delegateId, status: { in: draft ? ["PENDING", "FAILED", "SENT"] : ["PENDING", "FAILED"] } },
      })
    })

    await audit(session.user?.email ?? "unknown", "allotment.revoke", "Delegate", input.delegateId, {
      portfolioId: input.portfolioId,
    })
    if (cell) {
      await syncSheetCell({ committee: cell.committee.name, portfolio: cell.name, state: "available" })
    }

    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === "LIVE_PAYMENT_LINK") {
      return { success: false, error: "This allotment has a live payment link. Disable that link before revoking it." }
    }
    if (error instanceof Error && error.message === "PAYMENT_FINAL") {
      return { success: false, error: "A confirmed payment cannot be undone by revoking the allotment." }
    }
    return { success: false, error: "Revoke failed. Please try again." }
  }
}
