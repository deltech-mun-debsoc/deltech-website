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
    <AuthStage marker={t("auth.accountMarker")} headline={[t("auth.accountHeadline1"), t("auth.accountHeadline2")]}>
      <h2 className="font-heading text-4xl leading-tight">{t("account.title")}</h2>
      <p className="mt-2 text-base text-black/65">{user.email}</p>

      <h3 className="mt-7 border-t border-black/15 pt-6 font-sans text-lg font-semibold">
        {hasPassword ? t("account.changePasswordTitle") : t("account.setPasswordTitle")}
      </h3>
      <p className="mt-1 mb-6 text-sm leading-relaxed text-black/65">
        {hasPassword ? t("account.changePasswordNote") : t("account.setPasswordNote")}
      </p>

      <PasswordForm hasPassword={hasPassword} />

      <p className="mt-7 border-t border-black/15 pt-5 text-sm">
        <Link href={roleHome(user.role)} className="font-semibold text-teal-800 underline underline-offset-4">
          {t("account.backLink")}
        </Link>
      </p>
    </AuthStage>
  )
}
