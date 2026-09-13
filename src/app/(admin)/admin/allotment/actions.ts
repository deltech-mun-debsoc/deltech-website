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
    const txResult = await prisma.$transaction(async (tx) => {
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

      // 2. Confirm delegate is still REGISTERED
      const delegate = await tx.delegate.findUnique({
        where: { id: input.delegateId },
        select: { isDtu: true, status: true, email: true, publicToken: true },
      })
      if (!delegate || delegate.status !== "REGISTERED") {
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

      // 5. Payment provider from settings
      const providerSetting = await tx.setting.findUnique({ where: { key: "paymentProvider" } })
      const paymentProvider =
        typeof providerSetting?.value === "string" ? providerSetting.value : "upi_qr"

      // 6. Create Allotment, unique constraint on portfolioId is the final race guard
      await tx.allotment.create({
        data: {
          delegateId: input.delegateId,
          committeeId: input.committeeId,
          portfolioId: input.portfolioId,
          allottedBy: adminEmail,
        },
      })

      // 7. Portfolio → ALLOTTED
      await tx.portfolio.update({
        where: { id: input.portfolioId },
        data: { status: "ALLOTTED", holdToken: null, holdExpiresAt: null },
      })

      // 8. Delegate → ALLOTTED
      await tx.delegate.update({
        where: { id: input.delegateId },
        data: { status: paymentsEnabled ? "ALLOTTED" : "CONFIRMED" },
      })

      // 9. Payment row, provider + amount both from DB, link set after transaction
      if (paymentsEnabled && fee) {
        await tx.payment.create({
          data: {
            delegateId: input.delegateId,
            provider: paymentProvider,
            amountInr: fee.amountInr,
            status: "PENDING",
          },
        })
      }

      return {
        fee: fee ? { amountInr: fee.amountInr } : null,
        delegateEmail: delegate.email,
        delegateToken: delegate.publicToken,
      }
    })

    // Generate the payment link outside the transaction, because it is an
    // external HTTP call. It also gets its own try/catch: the allotment above
    // is already durably committed, so letting a provider outage fall through
    // to the outer catch reported "Allotment failed. Please try again." while
    // silently skipping the email, the audit entry and the sheet sync. The
    // delegate was left allotted with no link and no notification, and the
    // admin was told nothing had happened.
    let payLinkFailed = false
    if (paymentsEnabled && txResult.fee) {
      try {
        const provider = await getActiveProvider()
        const { link, orderId } = await provider.createPaymentLink({
          delegateId: input.delegateId,
          publicToken: txResult.delegateToken,
          amountInr: txResult.fee.amountInr,
          email: txResult.delegateEmail,
        })
        await prisma.payment.update({
          where: { delegateId: input.delegateId },
          data: {
            paymentLink: link,
            status: "SENT",
            ...(orderId ? { razorpayOrderId: orderId } : {}),
          },
        })
        await prisma.delegate.update({
          where: { id: input.delegateId },
          data: { status: "PAYMENT_SENT" },
        })
      } catch (err) {
        payLinkFailed = true
        console.error("[allotPortfolio] payment link generation failed", err)
      }
    }

    // Fire allotment email; co-delegate notice only for a double-delegation committee.
    // Skipped when the pay link failed, because that email's whole point is to
    // carry the link. Regenerating it from the drawer sends the email.
    try {
      if (!payLinkFailed) await sendAllotmentEmail(input.delegateId)
    } catch {
      // email failure must not roll back the allotment
    }
    try {
      await sendCoDelegateNotice(input.delegateId)
    } catch {
      // intentionally silent
    }

    await audit(adminEmail, "allotment.create", "Delegate", input.delegateId, {
      portfolioId: input.portfolioId,
      committeeId: input.committeeId,
      paymentsEnabled,
    })
    await syncSheetForDelegate(input.delegateId)

    if (payLinkFailed) {
      return {
        success: true,
        warning:
          "Allotted, but the payment link could not be generated, so no email was sent. Use “Regenerate pay link” in the delegate drawer once the provider is back.",
      }
    }
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
      if (payment?.status === "SENT") throw new Error("LIVE_PAYMENT_LINK")
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
        where: { delegateId: input.delegateId, status: { in: ["PENDING", "FAILED"] } },
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
