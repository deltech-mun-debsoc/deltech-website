"use server"

import { prisma } from "@/lib/prisma"
import { requireStaff, requireAdmin } from "@/lib/authz"
import { audit } from "@/lib/audit"
import { revalidatePath } from "next/cache"

export interface MemberData {
  name: string
  designation: string
  order: number
  imageUrl?: string
  socials?: { instagram?: string; linkedin?: string }
  isActive: boolean
}


// Prisma error codes that mean something specific enough to tell the operator.
// An unbound `catch {}` here used to discard the code entirely, so a row that had
// already been deleted (P2025, a stale list) reported the same dead-end
// "Failed to delete member." as a genuine failure, with nothing logged.
function memberError(err: unknown, fallback: string): { success: false; error: string } {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : null
  console.error("[admin/team]", code ?? "unknown", err)
  if (code === "P2025") {
    return { success: false, error: "That member was already removed. Refreshing the list." }
  }
  return { success: false, error: fallback }
}

export async function createMember(data: MemberData): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  if (!data.name.trim() || !data.designation.trim()) {
    return { success: false, error: "Name and designation are required." }
  }
  try {
    const member = await prisma.member.create({
      data: {
        name: data.name.trim(),
        designation: data.designation.trim(),
        order: data.order,
        imageUrl: data.imageUrl || null,
        socials: data.socials ?? undefined,
        isActive: data.isActive,
      },
    })
    await audit(session.user?.email ?? "unknown", "member.create", "Member", member.id, { name: data.name })
    return { success: true }
  } catch (err) {
    return memberError(err, "Failed to create member.")
  }
}

export async function updateMember(
  id: string,
  data: MemberData,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireStaff()
  try {
    await prisma.member.update({
      where: { id },
      data: {
        name: data.name.trim(),
        designation: data.designation.trim(),
        order: data.order,
        imageUrl: data.imageUrl || null,
        socials: data.socials ?? undefined,
        isActive: data.isActive,
      },
    })
    await audit(session.user?.email ?? "unknown", "member.update", "Member", id)
    return { success: true }
  } catch (err) {
    return memberError(err, "Failed to update member.")
  }
}

export async function deleteMember(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireAdmin()
    // deleteMany makes retries and stale tabs safe: the desired state is
    // "member absent", whether this click or an earlier one removed the row.
    await prisma.member.deleteMany({ where: { id } })
    await audit(session.user?.email ?? "unknown", "member.delete", "Member", id)
    revalidatePath("/admin/team")
    revalidatePath("/team")
    return { success: true }
  } catch (err) {
    return memberError(err, "Failed to delete member.")
  }
}
