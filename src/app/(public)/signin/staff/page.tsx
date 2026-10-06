import Link from "next/link"
import { redirect } from "next/navigation"
import { landingFor } from "@/lib/landing"
import { STRINGS, t } from "@/content/strings"
import { AuthStage } from "@/components/auth-stage"
import { SignInForm } from "../_components/sign-in-form"
import { AuthErrorBanner } from "../_components/auth-error-banner"

export const metadata = { title: STRINGS.auth.staffSignInTitle + " · " + STRINGS.brand.name }

export default async function StaffSignInPage(props: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const { callbackUrl, error } = await props.searchParams

  // Same reasoning as the delegate door: see the comment in ../page.tsx.
  const target = await landingFor(callbackUrl)
  if (target) redirect(target)

  return (
    <AuthStage kind="staff" marker={t("auth.staffMarker")} headline={[t("auth.staffHeadline1"), t("auth.staffHeadline2")]} intro={t("auth.staffIntro")}>
      <h2 className="font-heading text-4xl leading-tight">{t("auth.staffSignInTitle")}</h2>
      <p className="mt-3 text-base leading-relaxed text-black/65">{t("auth.staffSignInHint")}</p>
      <AuthErrorBanner error={error} />
      {/* Magic link first: an invited staffer has no passwordHash yet, since
          that column is only ever written at /signup. Defaulting to the
          password tab sent every new maintainer straight into "Invalid email
          or password" on their first visit. */}
      <div className="mt-7">
        <SignInForm defaultTab="magic" callbackUrl={callbackUrl} />
      </div>
      <p className="mt-7 border-t border-black/15 pt-5 text-sm text-black/65">
        {t("auth.notStaff")} <Link href="/signin" className="font-semibold text-amber-800 underline underline-offset-4">{t("auth.delegateLink")}</Link>
      </p>
    </AuthStage>
  )
}
