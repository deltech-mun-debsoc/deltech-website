// The origin this deployment puts in outbound links: status pages, payment
// links, check-in QR codes, blog links, quiz join URLs.
//
// Each consumer used to read NEXT_PUBLIC_APP_URL directly, defaulting to "".
// That was fine when previews shared the production database and were told to
// point at production anyway, but it makes a staging environment untestable:
// every link in a staging email would open production.
//
//   Production   NEXT_PUBLIC_APP_URL = https://deltechmun.in
//   Staging      NEXT_PUBLIC_APP_URL = https://test.deltechmun.in
//
// Both variables are NEXT_PUBLIC_, so this resolves identically on the server
// and in the one client component that needs it (the quiz presenter).
// NEXT_PUBLIC_VERCEL_URL is injected by Vercel and carries no scheme.

/** Pure so scripts/check-app-url.ts can pin the fallback order. */
export function resolveAppUrl(
  explicit: string | undefined,
  vercelUrl: string | undefined,
  productionUrl?: string,
  // True on ANY hosted deployment, preview included. It was production-only,
  // which is how a Preview build with NEXT_PUBLIC_APP_URL=http://localhost:3000
  // came to print localhost into the quiz join QR code: nothing on a preview
  // rejected the loopback value, so it won outright.
  hosted = false,
): string {
  const set = explicit?.trim()
  const localExplicit = set ? isLoopback(set) : false
  if (set && !(hosted && localExplicit)) return stripTrailingSlash(set)

  const production = productionUrl?.trim()
  if (production) {
    return `https://${stripTrailingSlash(production.replace(/^https?:\/\//, ""))}`
  }

  const vercel = vercelUrl?.trim()
  if (vercel) return `https://${stripTrailingSlash(vercel.replace(/^https?:\/\//, ""))}`

  // Keep localhost useful in local development even when no Vercel variables
  // exist. A hosted deployment is never allowed to emit a loopback link: a QR
  // code or a payment link pointing at localhost is worse than one pointing
  // nowhere, because it looks like it works.
  return set && !hosted ? stripTrailingSlash(set) : ""
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "")
}

function isLoopback(value: string): boolean {
  try {
    const url = new URL(value)
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  } catch {
    return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value)
  }
}

export const APP_URL: string = resolveAppUrl(
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.NEXT_PUBLIC_VERCEL_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
  // Any Vercel deployment, not just production: a preview must not hand out
  // localhost links either.
  process.env.VERCEL === "1",
)

/** Join a path onto the deployment origin. Returns the bare path when unset. */
export function appUrl(path: string): string {
  return `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`
}

export function absoluteAppUrl(path: string): string {
  const value = appUrl(path)
  if (!/^https?:\/\//.test(value)) {
    throw new Error("The public app URL is not configured.")
  }
  return value
}
