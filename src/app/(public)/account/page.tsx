import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { t } from "@/content/strings"
import { roleHome } from "@/lib/nav"
import { AuthStage } from "@/components/auth-stage"
import { PasswordForm } from "./_components/password-form"

export const metadata = { title: "Account · DelTech MUN" }

export default async function AccountPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin?callbackUrl=/account")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true, role: true, passwordHash: true },
  })
  if (!user) redirect("/signin")

  const hasPassword = !!user.passwordHash

  return (
    <AuthStage>
      <h1 className="text-2xl font-semibold">{t("account.title")}</h1>
      <p className="mt-1 text-base text-muted-foreground">{user.email}</p>

      <h2 className="mt-7 border-t border-border pt-6 text-lg font-semibold">
        {hasPassword ? t("account.changePasswordTitle") : t("account.setPasswordTitle")}
      </h2>
      <p className="mt-1 mb-6 text-sm leading-relaxed text-muted-foreground">
        {hasPassword ? t("account.changePasswordNote") : t("account.setPasswordNote")}
      </p>

      <PasswordForm hasPassword={hasPassword} />

      <p className="mt-8 border-t border-border pt-5 text-sm">
        <Link href={roleHome(user.role)} className="font-semibold underline underline-offset-4">
          {t("account.backLink")}
        </Link>
      </p>
    </AuthStage>
  )
}
