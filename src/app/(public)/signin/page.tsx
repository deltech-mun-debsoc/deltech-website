import Link from "next/link"
import { t } from "@/content/strings"
import { SignInForm } from "./_components/sign-in-form"
import { AuthStage } from "./_components/auth-stage"
import { AuthErrorBanner } from "./_components/auth-error-banner"

export default async function SignInPage(props: {
  searchParams: Promise<{ created?: string; callbackUrl?: string; error?: string }>
}) {
  const { created, callbackUrl, error } = await props.searchParams

  return (
    <AuthStage kind="delegate">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Identity / 01</p>
      <h2 className="mt-5 max-w-[11ch] font-heading text-4xl leading-tight sm:text-5xl">{t("auth.signInTitle")}</h2>
      <p className="mt-3 max-w-md text-base leading-relaxed text-black/55">Use a one-time email link or your password. Both enter the same delegate portal.</p>
      {created && <div className="mt-5 border-l-4 border-teal-700 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">Account created. Your door is ready.</div>}
      <AuthErrorBanner error={error} />
      <div className="my-7 h-px bg-black/15" />
      <SignInForm callbackUrl={callbackUrl} />
      <div className="mt-7 flex flex-col gap-3 border-t border-black/15 pt-5 text-sm sm:flex-row sm:justify-between">
        <span>New delegate? <Link href="/signup" className="font-bold text-teal-800 underline">Create your identity</Link></span>
        <Link href="/signin/staff" className="text-black/55 underline hover:text-black">Secretariat door →</Link>
      </div>
    </AuthStage>
  )
}
