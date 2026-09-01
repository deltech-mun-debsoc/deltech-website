import { t, type StringKey } from "@/content/strings"

// Auth.js is configured with pages.error = "/signin" (src/lib/auth.config.ts), so
// every callback failure redirects here carrying ?error=<type>. Both sign-in
// pages read only `created` and `callbackUrl`, so all of them rendered nothing:
// verified against production, /signin and /signin?error=Verification had no
// visible difference at all. Someone whose link had expired -- or been consumed
// by a mail scanner prefetching it, since the token is single use -- clicked it
// and arrived back at an unchanged form with no explanation, which is why this
// looked like the magic link silently bouncing people.
const MESSAGE: Record<string, StringKey> = {
  Verification: "auth.errorVerification",
  AccessDenied: "auth.errorAccessDenied",
  Configuration: "auth.errorConfiguration",
}

export function AuthErrorBanner({ error }: { error?: string }) {
  if (!error) return null
  // An unrecognised type is still a real failure and still gets said out loud.
  // Falling through to null here would recreate the exact silence being fixed.
  const key = MESSAGE[error] ?? "auth.errorConfiguration"

  return (
    <div
      role="alert"
      className="mt-5 border-l-4 border-red-700 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900"
    >
      {t(key)}
    </div>
  )
}
