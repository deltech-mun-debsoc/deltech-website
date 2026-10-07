import Link from "next/link"
import { redirect } from "next/navigation"
import { landingFor } from "@/lib/landing"
import { t } from "@/content/strings"
import { AuthStage } from "@/components/auth-stage"
import { SignInForm } from "./_components/sign-in-form"
import { AuthErrorBanner } from "./_components/auth-error-banner"

export default async function SignInPage(props: {
  searchParams: Promise<{ created?: string; callbackUrl?: string; error?: string }>
}) {
  const { created, callbackUrl, error } = await props.searchParams

  // Already signed in: this page is a door, not a destination. Without this a
  // signed-in visitor gets a login form that reads as "you are logged out",
  // and the only way forward is to authenticate a second time. Dispatch the
  // same way /go does, so an intended callbackUrl is still honoured and a role
  // that cannot reach it is downgraded to its own home rather than bounced.
  const target = await landingFor(callbackUrl)
  if (target) redirect(target)

  return (
    <AuthStage marker="Delegate and staff access">
      <h1 className="font-display text-4xl font-normal leading-tight">{t("auth.signInTitle")}</h1>
      {created && <p role="status" className="mt-5 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium">{t("auth.accountCreated")}</p>}
      <AuthErrorBanner error={error} />
      <div className="mt-6">
        <SignInForm callbackUrl={callbackUrl} />
      </div>
      <p className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
        {t("auth.newDelegate")}{" "}
        <Link href="/signup" className="font-semibold text-foreground underline underline-offset-4">{t("auth.signUpLinkText")}</Link>
      </p>
    </AuthStage>
  )
}
