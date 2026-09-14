"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import { audit } from "@/lib/audit"

export interface CheckInResult {
  success: boolean
  alreadyCheckedIn: boolean
  checkedInAt: string | null
  checkedInBy: string | null
  error?: string
}

// ── checkInDelegate ────────────────────────────────────────────────────────────
// Idempotent: if the delegate is already checked in, this is a no-op that just
// returns the existing state (never errors). Race-safe via a conditional
// updateMany (mirrors holdPortfolio's AVAILABLE → ON_HOLD guard in
// admin/allotment/actions.ts), if two staff members tap "Check in" for the
// same delegate at once, only one write wins and the other observes it.
export async function checkInDelegate(delegateId: string): Promise<CheckInResult> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"

  const delegate = await prisma.delegate.findUnique({
    where: { id: delegateId },
    select: { fullName: true, checkedInAt: true, checkedInBy: true },
  })
  if (!delegate) {
    return { success: false, alreadyCheckedIn: false, checkedInAt: null, checkedInBy: null, error: "Delegate not found." }
  }

  if (delegate.checkedInAt) {
    return {
      success: true,
      alreadyCheckedIn: true,
      checkedInAt: delegate.checkedInAt.toISOString(),
      checkedInBy: delegate.checkedInBy,
    }
  }

  const now = new Date()
  const result = await prisma.delegate.updateMany({
    where: { id: delegateId, checkedInAt: null },
    data: { checkedInAt: now, checkedInBy: actorEmail },
  })

  if (result.count === 0) {
    // Lost the race, another staff member just checked this delegate in.
    const fresh = await prisma.delegate.findUniqueOrThrow({
      where: { id: delegateId },
      select: { checkedInAt: true, checkedInBy: true },
    })
    return {
      success: true,
      alreadyCheckedIn: true,
      checkedInAt: fresh.checkedInAt?.toISOString() ?? null,
      checkedInBy: fresh.checkedInBy,
    }
  }

  await audit(actorEmail, "checkin", "Delegate", delegateId, { fullName: delegate.fullName })
  revalidatePath("/admin/checkin")

  return {
    success: true,
    alreadyCheckedIn: false,
    checkedInAt: now.toISOString(),
    checkedInBy: actorEmail,
  }
}

// ── undoCheckIn ────────────────────────────────────────────────────────────────
// Symmetric idempotent guard: no-op if the delegate isn't currently checked in.
export async function undoCheckIn(delegateId: string): Promise<CheckInResult> {
  const session = await requireStaff()
  const actorEmail = session.user?.email ?? "admin"

  const delegate = await prisma.delegate.findUnique({
    where: { id: delegateId },
    select: { fullName: true, checkedInAt: true, checkedInBy: true },
  })
  if (!delegate) {
    return { success: false, alreadyCheckedIn: false, checkedInAt: null, checkedInBy: null, error: "Delegate not found." }
  }

  if (!delegate.checkedInAt) {
    return { success: true, alreadyCheckedIn: false, checkedInAt: null, checkedInBy: null }
  }

  const result = await prisma.delegate.updateMany({
    where: { id: delegateId, checkedInAt: { not: null } },
    data: { checkedInAt: null, checkedInBy: null },
  })

  if (result.count > 0) {
    await audit(actorEmail, "checkin_undo", "Delegate", delegateId, { fullName: delegate.fullName })
    revalidatePath("/admin/checkin")
  }

  return { success: true, alreadyCheckedIn: false, checkedInAt: null, checkedInBy: null }
}
