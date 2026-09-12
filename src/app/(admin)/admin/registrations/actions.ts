"use server"

import { prisma } from "@/lib/prisma"
import { requireStaff, requireAdmin } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { getActiveProvider } from "@/lib/payments"
import { delegateInclude, serializeDelegate, type SerializedDelegate, type EmailLogEntry } from "./_lib/types"
import { sendAllotmentEmail, sendPaymentConfirmed, resendByLogId } from "@/lib/resend"
import { syncSheetCell, syncSheetForDelegate } from "@/lib/sheet-sync"
import { detailedChangeMeta } from "@/lib/audit-change"

export interface DelegateEditData {
  fullName: string
  email: string
  whatsapp: string
  altPhone?: string
  institution: string
  isDtu: boolean
  rollNumber?: string
  munExperience?: string
  pref1Portfolio?: string
  pref2Portfolio?: string
  needsAccommodation: boolean
  outsideNcr: boolean
  reference?: string
}

// Fields the Google Form importer writes AND an organiser can edit here. Email is
// deliberately absent: it is the identity, and the importer never updates it.
const MANUAL_TRACKED = ["fullName", "whatsapp", "rollNumber", "munExperience", "pref1Portfolio", "pref2Portfolio"] as const

async function reloadDelegate(delegateId: string): Promise<SerializedDelegate> {
  const updated = await prisma.delegate.findUniqueOrThrow({
    where: { id: delegateId },
    include: delegateInclude,
  })
  return serializeDelegate(updated)
}

export async function updateDelegate(
  id: string,
  data: DelegateEditData,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  try {
    const fields = {
      fullName: true,
      email: true,
      whatsapp: true,
      altPhone: true,
      institution: true,
      isDtu: true,
      rollNumber: true,
      munExperience: true,
      pref1Portfolio: true,
      pref2Portfolio: true,
      needsAccommodation: true,
      outsideNcr: true,
      reference: true,
    } as const
    const { before, after } = await prisma.$transaction(async (tx) => {
      const before = await tx.delegate.findUniqueOrThrow({ where: { id }, select: fields })
      const { manualEditedFields } = await tx.delegate.findUniqueOrThrow({
        where: { id },
        select: { manualEditedFields: true },
      })
      // A delegate imported from a Google Form response sheet is refreshed by the
      // next Refetch. Without recording what a human changed here, that refetch
      // would silently put the old answer back: someone fixes a typo'd phone
      // number, presses Refetch an hour later, and the typo returns. The importer
      // never overwrites a field listed here (see withheldManualEdits).
      const next: Record<(typeof MANUAL_TRACKED)[number], string | null> = {
        fullName: data.fullName,
        whatsapp: data.whatsapp,
        rollNumber: data.rollNumber?.trim() || null,
        munExperience: data.munExperience || null,
        pref1Portfolio: data.pref1Portfolio || null,
        pref2Portfolio: data.pref2Portfolio || null,
      }
      const touched = MANUAL_TRACKED.filter((k) => (before[k] ?? null) !== next[k])
      const after = await tx.delegate.update({
        where: { id },
        data: {
          fullName: data.fullName,
          // Email is the identity the form importer and the duplicate check match
          // on, case-insensitively. Store it the one way both compare it.
          email: data.email.trim().toLowerCase(),
          whatsapp: data.whatsapp,
          rollNumber: next.rollNumber,
          manualEditedFields: [...new Set([...manualEditedFields, ...touched])],
          altPhone: data.altPhone || null,
          institution: data.institution,
          isDtu: data.isDtu,
          munExperience: data.munExperience || null,
          pref1Portfolio: data.pref1Portfolio || null,
          pref2Portfolio: data.pref2Portfolio || null,
          needsAccommodation: data.needsAccommodation,
          outsideNcr: data.outsideNcr,
          reference: data.reference || null,
        },
        select: fields,
      })
      return { before, after }
    })
    await audit(
      session.user?.email ?? "unknown",
      "delegate.update",
      "Delegate",
      id,
      detailedChangeMeta({
        summary: `Updated ${after.fullName}'s registration details.`,
        before,
        after,
      },
      ),
    )
    return { success: true }
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002") {
      return { success: false, error: "Another delegate already uses this email." }
    }
    return { success: false, error: "Update failed. Please try again." }
  }
}

export async function markPaidOffline(
  delegateId: string,
): Promise<{ success: boolean; error?: string; delegate?: SerializedDelegate }> {
  const session = await requireAdmin()
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { delegateId },
        select: { status: true },
      })
      if (!payment || !["PENDING", "SENT", "FAILED"].includes(payment.status)) {
        throw new Error("PAYMENT_NOT_PAYABLE")
      }
      const claimed = await tx.payment.updateMany({
        where: { delegateId, status: { in: ["PENDING", "SENT", "FAILED"] } },
        data: { status: "OFFLINE", confirmedAt: new Date(), method: "upi_manual" },
      })
      if (claimed.count !== 1) throw new Error("PAYMENT_RACE")
      const confirmed = await tx.delegate.updateMany({
        where: { id: delegateId, status: { in: ["ALLOTTED", "PAYMENT_SENT"] } },
        data: { status: "CONFIRMED" },
      })
      if (confirmed.count !== 1) throw new Error("DELEGATE_NOT_CONFIRMABLE")
    })
    await audit(session.user?.email ?? "unknown", "delegate.markPaidOffline", "Delegate", delegateId)
    await syncSheetForDelegate(delegateId)
    try {
      await sendPaymentConfirmed(delegateId)
    } catch {
      // email failure must not surface to the admin
    }
    return { success: true, delegate: await reloadDelegate(delegateId) }
  } catch (error) {
    if (error instanceof Error && /PAYMENT|DELEGATE/.test(error.message)) {
      return { success: false, error: "This payment changed while you were viewing it. Refresh before confirming." }
    }
    return { success: false, error: "Failed to mark as paid. Please try again." }
  }
}

// Comp: no fee expected (sponsored/EB courtesy). Payment row → COMPED, delegate → CONFIRMED.
export async function compDelegate(
  delegateId: string,
): Promise<{ success: boolean; error?: string; delegate?: SerializedDelegate }> {
  const session = await requireAdmin()
  try {
    await prisma.$transaction(async (tx) => {
      const delegate = await tx.delegate.findUnique({
        where: { id: delegateId },
        select: {
          status: true,
          allotment: { select: { id: true } },
          payment: { select: { status: true } },
        },
      })
      if (!delegate?.allotment) throw new Error("ALLOTMENT_REQUIRED")
      if (delegate.status === "CANCELLED" || delegate.status === "CONFIRMED") {
        throw new Error("DELEGATE_NOT_CONFIRMABLE")
      }
      if (delegate.payment && ["PAID", "OFFLINE", "COMPED"].includes(delegate.payment.status)) {
        throw new Error("PAYMENT_ALREADY_FINAL")
      }
      if (delegate.payment) {
        const claimed = await tx.payment.updateMany({
          where: { delegateId, status: { in: ["PENDING", "SENT", "FAILED"] } },
          data: { status: "COMPED", confirmedAt: new Date(), method: "comp" },
        })
        if (claimed.count !== 1) throw new Error("PAYMENT_RACE")
      } else {
        await tx.payment.create({
          data: {
            delegateId,
            provider: "comp",
            amountInr: 0,
            status: "COMPED",
            confirmedAt: new Date(),
            method: "comp",
          },
        })
      }
      const confirmed = await tx.delegate.updateMany({
        where: { id: delegateId, status: { in: ["ALLOTTED", "PAYMENT_SENT"] } },
        data: { status: "CONFIRMED" },
      })
      if (confirmed.count !== 1) throw new Error("DELEGATE_NOT_CONFIRMABLE")
    })
    await audit(session.user?.email ?? "unknown", "delegate.comp", "Delegate", delegateId)
    await syncSheetForDelegate(delegateId)
    try {
      await sendPaymentConfirmed(delegateId)
    } catch {
      // best-effort
    }
    return { success: true, delegate: await reloadDelegate(delegateId) }
  } catch (error) {
    if (error instanceof Error && error.message === "ALLOTMENT_REQUIRED") {
      return { success: false, error: "Allot a portfolio before marking this delegate as complimentary." }
    }
    if (error instanceof Error && /PAYMENT|DELEGATE/.test(error.message)) {
      return { success: false, error: "This delegate or payment has already moved to another state. Refresh first." }
    }
    return { success: false, error: "Failed to comp. Please try again." }
  }
}

// Cancel: frees any allotted portfolio, drops unpaid payment rows, delegate → CANCELLED.
export async function cancelDelegate(
  delegateId: string,
): Promise<{ success: boolean; error?: string; delegate?: SerializedDelegate }> {
  const session = await requireAdmin()
  try {
    const freedCell = await prisma.$transaction(async (tx) => {
      const delegate = await tx.delegate.findUnique({
        where: { id: delegateId },
        select: { status: true, payment: { select: { status: true } } },
      })
      if (!delegate) throw new Error("DELEGATE_NOT_FOUND")
      if (
        delegate.status === "CONFIRMED" ||
        (delegate.payment && ["PAID", "OFFLINE", "COMPED"].includes(delegate.payment.status))
      ) {
        throw new Error("CONFIRMED_CANNOT_CANCEL")
      }
      if (delegate.payment?.status === "SENT") {
        throw new Error("LIVE_PAYMENT_LINK")
      }
      const allotment = await tx.allotment.findUnique({
        where: { delegateId },
        include: { portfolio: { include: { committee: { select: { name: true } } } } },
      })
      if (allotment) {
        await tx.allotment.delete({ where: { id: allotment.id } })
        await tx.portfolio.update({
          where: { id: allotment.portfolioId },
          data: { status: "AVAILABLE" },
        })
      }
      await tx.payment.deleteMany({
        where: { delegateId, status: { in: ["PENDING", "SENT", "FAILED"] } },
      })
      await tx.delegate.update({ where: { id: delegateId }, data: { status: "CANCELLED" } })
      return allotment
        ? { committee: allotment.portfolio.committee.name, portfolio: allotment.portfolio.name }
        : null
    })
    await audit(session.user?.email ?? "unknown", "delegate.cancel", "Delegate", delegateId)
    if (freedCell) {
      await syncSheetCell({ ...freedCell, state: "available" })
    }
    return { success: true, delegate: await reloadDelegate(delegateId) }
  } catch (error) {
    if (error instanceof Error && error.message === "CONFIRMED_CANNOT_CANCEL") {
      return { success: false, error: "Confirmed delegates need a separate refund/removal process; they cannot be cancelled here." }
    }
    if (error instanceof Error && error.message === "LIVE_PAYMENT_LINK") {
      return { success: false, error: "This delegate has a live payment link. Disable that link before cancelling the registration." }
    }
    return { success: false, error: "Failed to cancel. Please try again." }
  }
}

export async function waitlistDelegate(
  delegateId: string,
  waitlisted: boolean,
): Promise<{ success: boolean; error?: string; delegate?: SerializedDelegate }> {
  const session = await requireStaff()
  try {
    const result = await prisma.delegate.updateMany({
      where: { id: delegateId, status: waitlisted ? "REGISTERED" : "WAITLISTED" },
      data: { status: waitlisted ? "WAITLISTED" : "REGISTERED" },
    })
    if (result.count === 0) {
      return { success: false, error: "Only unallotted delegates can be (un)waitlisted." }
    }
    await audit(
      session.user?.email ?? "unknown",
      waitlisted ? "delegate.waitlist" : "delegate.unwaitlist",
      "Delegate",
      delegateId,
    )
    return { success: true, delegate: await reloadDelegate(delegateId) }
  } catch {
    return { success: false, error: "Failed to update waitlist status." }
  }
}

// Recovers delegates stuck in ALLOTTED (fee/provider misconfig at allotment time).
export async function regeneratePaymentLink(
  delegateId: string,
): Promise<{ success: boolean; error?: string; warning?: string; delegate?: SerializedDelegate }> {
  const session = await requireStaff()
  try {
    const delegate = await prisma.delegate.findUniqueOrThrow({
      where: { id: delegateId },
      select: {
        publicToken: true,
        email: true,
        isDtu: true,
        status: true,
        allotment: { include: { portfolio: { include: { committee: true } } } },
        payment: true,
      },
    })
    if (!delegate.allotment) return { success: false, error: "Delegate has no allotment." }
    if (delegate.status === "CONFIRMED" || delegate.payment?.status === "PAID") {
      return { success: false, error: "Payment already confirmed." }
    }

    let amountInr = delegate.payment?.amountInr
    if (amountInr == null) {
      const fee = await prisma.fee.findFirst({
        where: {
          committeeType: delegate.allotment.portfolio.committee.type,
          isDtu: delegate.isDtu,
        },
      })
      if (!fee) return { success: false, error: "No matching fee configured, add one in Config → Fees." }
      amountInr = fee.amountInr
    }

    const provider = await getActiveProvider()
    const { link, orderId } = await provider.createPaymentLink({
      delegateId,
      publicToken: delegate.publicToken,
      amountInr,
      email: delegate.email,
    })
    const content = await import("@/lib/settings").then((m) => m.getContent())
    await prisma.payment.upsert({
      where: { delegateId },
      create: {
        delegateId,
        provider: content.paymentProvider,
        amountInr,
        status: "SENT",
        paymentLink: link,
        ...(orderId ? { razorpayOrderId: orderId } : {}),
      },
      update: {
        status: "SENT",
        paymentLink: link,
        ...(orderId ? { razorpayOrderId: orderId } : {}),
      },
    })
    await prisma.delegate.update({ where: { id: delegateId }, data: { status: "PAYMENT_SENT" } })
    await audit(session.user?.email ?? "unknown", "delegate.regeneratePaymentLink", "Delegate", delegateId)
    const updated = await reloadDelegate(delegateId)
    try {
      await sendAllotmentEmail(delegateId)
    } catch {
      return {
        success: true,
        warning: "The new link was saved, but the email failed. Copy the link from this drawer.",
        delegate: updated,
      }
    }
    return { success: true, delegate: updated }
  } catch {
    return { success: false, error: "Failed to regenerate payment link." }
  }
}

// Fetched when the drawer opens rather than joined onto every table row.
export async function getDelegateEmailLogs(delegateId: string): Promise<EmailLogEntry[]> {
  await requireStaff()
  const logs = await prisma.emailLog.findMany({
    where: { delegateId },
    orderBy: { sentAt: "desc" },
    take: 50,
    select: { id: true, template: true, status: true, error: true, sentAt: true },
  })
  return logs.map((l) => ({ ...l, sentAt: l.sentAt.toISOString() }))
}

export async function resendEmail(
  logId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  try {
    await resendByLogId(logId)
    await audit(session.user?.email ?? "unknown", "email.resend", "EmailLog", logId)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Resend failed." }
  }
}
