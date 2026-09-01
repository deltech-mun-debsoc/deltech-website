import Link from "next/link"
import { STRINGS } from "@/content/strings"
import { SignInForm } from "../_components/sign-in-form"
import { AuthStage } from "../_components/auth-stage"
import { AuthErrorBanner } from "../_components/auth-error-banner"

export const metadata = { title: "Secretariat · " + STRINGS.brand.name }

export default async function StaffSignInPage(props: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const { callbackUrl, error } = await props.searchParams
  return (
    <AuthStage kind="staff">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Clearance / Staff</p>
      <h2 className="mt-5 max-w-[12ch] font-heading text-4xl leading-tight sm:text-5xl">Secretariat access.</h2>
      <p className="mt-3 max-w-md text-base leading-relaxed text-black/55">Use the email an admin approved. First time in, take the magic link, then set a password from your account page.</p>
      <AuthErrorBanner error={error} />
      <div className="my-7 h-px bg-black/15" />
      {/* Magic link first: an invited staffer has no passwordHash yet, since
          that column is only ever written at /signup. Defaulting to the
          password tab sent every new maintainer straight into "Invalid email
          or password" on their first visit. */}
      <SignInForm defaultTab="magic" callbackUrl={callbackUrl} />
      <p className="mt-7 border-t border-black/15 pt-5 text-sm text-black/55">
        Not staff? <Link href="/signin" className="font-bold text-amber-800 underline">Return to delegate access</Link>
      </p>
    </AuthStage>
  )
}
