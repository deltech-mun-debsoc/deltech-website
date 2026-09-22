"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { hashPassword, verifyPassword } from "@/lib/password"
import { validatePassword } from "@/lib/schemas/password"

// Sets or changes the signed-in user's own password.
//
// When the account already has a password, the current one is required, so a
// borrowed session cannot silently lock the owner out. When it does not (every
// admin-invited staffer, since a password is only written after verification),
// the authenticated session is itself the proof of identity: they got here by
// clicking a single-use link sent to their own inbox.
export async function setOwnPassword(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: "notSignedIn" }

  const currentPassword = formData.get("currentPassword") as string | null
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  const invalid = validatePassword(password, confirmPassword)
  if (invalid) return { error: invalid }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  })
  if (!user) return { error: "notSignedIn" }

  if (user.passwordHash) {
    if (!currentPassword) return { error: "currentPasswordRequired" }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return { error: "currentPasswordWrong" }
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  })

  revalidatePath("/account")
  return { success: true }
}
