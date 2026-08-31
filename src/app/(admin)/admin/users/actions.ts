"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { deleteBlockReason } from "@/lib/user-admin"
import type { Prisma, Role } from "@/generated/prisma/client"
import { detailedChangeMeta } from "@/lib/audit-change"
import { derivedRecruitmentRole } from "@/lib/recruitment/permissions"

const ASSIGNABLE: Role[] = ["ADMIN", "MAINTAINER", "AUTHOR", "REGISTERER", "SUB_MAINTAINER"]

// `warning` is for "the thing you asked for happened, but something after it
// did not". The caller should still treat it as success and refresh.
type Result = { success: boolean; error?: string; warning?: string }

function isPrismaCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === code
}

class LastAdminError extends Error {
  constructor() {
    super("last-admin")
    this.name = "LastAdminError"
  }
}

// The one place that knows the "at least one enabled ADMIN must survive"
// invariant. setUserRole, setUserDisabled and deleteUser all route through it
// rather than each re-deriving the rule.
//
// Runs at Serializable so two admins demoting each other at the same instant
// cannot both observe the other as still-admin and both commit; Postgres
// aborts one with a serialization failure, surfaced as "please retry".
async function withAdminInvariant<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const out = await fn(tx)
      const adminsLeft = await tx.user.count({ where: { role: "ADMIN", disabledAt: null } })
      if (adminsLeft === 0) throw new LastAdminError()
      return out
    },
    { isolationLevel: "Serializable" },
  )
}

function mapInvariantError(err: unknown): Result | null {
  if (err instanceof LastAdminError) {
    return { success: false, error: "That would leave the site with no admin. Promote someone else first." }
  }
  // P2034: transaction conflict / write conflict. Another admin change raced this one.
  if (isPrismaCode(err, "P2034")) {
    return { success: false, error: "Another admin change happened at the same time. Please retry." }
  }
  return null
}

async function loadTarget(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, disabledAt: true },
  })
}

// Creates the User row with the right role, then emails a pointer to the
// staff door. No hand-minted tokens; the normal magic-link flow signs them in.
export async function inviteStaff(email: string, role: Role): Promise<Result> {
  const session = await requireAdmin()
  const normalized = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    return { success: false, error: "Enter a valid email." }
  }
  if (!ASSIGNABLE.includes(role)) return { success: false, error: "Invalid role." }

  let user
  try {
    user = await prisma.user.create({ data: { email: normalized, role } })
  } catch (err) {
    if (isPrismaCode(err, "P2002")) {
      return { success: false, error: "A user with this email already exists. Change their role below instead." }
    }
    return { success: false, error: "Failed to invite." }
  }

  await audit(session.user?.email ?? "unknown", "user.invite", "User", user.id, {
    email: normalized,
    role,
  })
  revalidatePath("/admin/users")

  // The account exists either way, so this is still a success, but don't
  // claim the email went out when it did not.
  try {
    const { sendStaffInvite } = await import("@/lib/resend")
    await sendStaffInvite(normalized, role)
  } catch {
    return {
      success: true,
      warning: `${normalized} was added, but the invite email failed to send. Ask them to sign in at /signin/staff with this address.`,
    }
  }

  return { success: true }
}

export async function setUserRole(userId: string, role: Role): Promise<Result> {
  const session = await requireAdmin()
  if (!ASSIGNABLE.includes(role)) return { success: false, error: "Invalid role." }

  const target = await loadTarget(userId)
  if (!target) return { success: false, error: "User not found." }
  if (target.email === session.user?.email) {
    return { success: false, error: "You can't change your own role." }
  }
  if (target.role === role) return { success: true }

  const recruitmentRole = derivedRecruitmentRole(role)

  try {
    await withAdminInvariant(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role } })

      // The dashboard role IS the recruitment role, so changing it here has to
      // move the recruitment memberships with it. Cycles keep a row per member
      // (RecruitmentStaffAssignment points at one), and those rows override the
      // derived role -- so a stale one left behind would quietly keep granting
      // the access this change was meant to remove, or cap a promotion at the
      // old role. Same transaction: never a window where the two disagree.
      if (recruitmentRole) {
        await tx.recruitmentMember.updateMany({
          where: { userId, isActive: true },
          data: { role: recruitmentRole },
        })
      } else {
        await tx.recruitmentMember.updateMany({
          where: { userId, isActive: true },
          data: { isActive: false, revokedAt: new Date(), revokedById: session.user!.id },
        })
      }
    })
  } catch (err) {
    const mapped = mapInvariantError(err)
    if (mapped) return mapped
    throw err
  }

  await audit(
    session.user?.email ?? "unknown",
    "user.setRole",
    "User",
    userId,
    detailedChangeMeta({
      summary: `Changed ${target.email}'s role.`,
      before: { role: target.role },
      after: { role, recruitmentRole: recruitmentRole ?? "none" },
    }),
  )
  revalidatePath("/admin/users")
  return { success: true }
}

// Reversible revoke. Works for every user including authors, whose posts and
// audit trail are left intact, unlike deleteUser, which refuses in that case.
export async function setUserDisabled(userId: string, disabled: boolean): Promise<Result> {
  const session = await requireAdmin()

  const target = await loadTarget(userId)
  if (!target) return { success: false, error: "User not found." }
  if (target.email === session.user?.email) {
    return { success: false, error: "You can't disable your own account." }
  }
  if (!!target.disabledAt === disabled) return { success: true }

  try {
    await withAdminInvariant((tx) =>
      tx.user.update({
        where: { id: userId },
        data: { disabledAt: disabled ? new Date() : null },
      }),
    )
  } catch (err) {
    const mapped = mapInvariantError(err)
    if (mapped) return mapped
    throw err
  }

  await audit(
    session.user?.email ?? "unknown",
    disabled ? "user.disable" : "user.enable",
    "User",
    userId,
    detailedChangeMeta({
      summary: disabled ? `Disabled ${target.email}.` : `Enabled ${target.email}.`,
      before: { disabled: !!target.disabledAt },
      after: { disabled },
    }),
  )
  revalidatePath("/admin/users")
  return { success: true }
}

// Hard delete, for cleaning up mistyped invites. Account and Session cascade.
// Post.authorId is ON DELETE RESTRICT and non-nullable, and Presentation.ownerId
// has no FK at all (so it would silently orphan), so refuse in both cases and
// point at disable, which achieves the same revocation without losing content.
export async function deleteUser(userId: string): Promise<Result> {
  const session = await requireAdmin()

  const target = await loadTarget(userId)
  if (!target) return { success: false, error: "User not found." }
  if (target.email === session.user?.email) {
    return { success: false, error: "You can't delete your own account." }
  }

  const [posts, presentations] = await Promise.all([
    prisma.post.count({ where: { authorId: userId } }),
    prisma.presentation.count({ where: { ownerId: userId } }),
  ])
  const blocked = deleteBlockReason(posts, presentations)
  if (blocked) return { success: false, error: blocked }

  try {
    await withAdminInvariant(async (tx) => {
      await tx.user.delete({ where: { id: userId } })
      // VerificationToken has no FK to User, so unspent magic links would
      // outlive the account. The signIn guard already refuses unknown
      // addresses, but leaving the rows behind is just litter.
      await tx.verificationToken.deleteMany({ where: { identifier: target.email } })
    })
  } catch (err) {
    const mapped = mapInvariantError(err)
    if (mapped) return mapped
    // P2003: something still references this user that we did not account for.
    if (isPrismaCode(err, "P2003")) {
      return { success: false, error: "Can't delete: other records still reference this account. Disable it instead." }
    }
    throw err
  }

  await audit(session.user?.email ?? "unknown", "user.delete", "User", userId, {
    email: target.email,
    role: target.role,
  })
  revalidatePath("/admin/users")
  return { success: true }
}
