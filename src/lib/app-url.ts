// The origin this deployment puts in outbound links: status pages, payment
// links, check-in QR codes, blog links, quiz join URLs.
//
// Each consumer used to read NEXT_PUBLIC_APP_URL directly, defaulting to "".
// That was fine when previews shared the production database and were told to
// point at production anyway, but it makes a staging environment untestable:
// every link in a staging email would open production.
//
//   Production   NEXT_PUBLIC_APP_URL = https://www.deltechmun.in
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
  const deploymentExplicit = set ? isVercelDeploymentUrl(set) : false
  if (set && !(hosted && (localExplicit || deploymentExplicit))) {
    return canonicalizeProductionDomain(stripTrailingSlash(set))
  }

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

function isVercelDeploymentUrl(value: string): boolean {
  try {
    return new URL(value).hostname.endsWith(".vercel.app")
  } catch {
    return false
  }
}

function canonicalizeProductionDomain(value: string): string {
  try {
    const url = new URL(value)
    if (url.hostname === "deltechmun.in") url.hostname = "www.deltechmun.in"
    return stripTrailingSlash(url.toString())
  } catch {
    return value
  }
}

// The production domain is only the right fallback ON production. It used to be
// handed to every Vercel deployment, so a staging build that forgot
// NEXT_PUBLIC_APP_URL fell straight through to www.deltechmun.in and put
// PRODUCTION links in staging emails, payment links and QR codes -- the exact
// failure this module was written to prevent, reintroduced one argument later.
// Staging passes undefined instead, so it falls through to the deployment's own
// URL: a link to the wrong staging host is recoverable, a link that quietly
// points testers at production is not.
//
// "Hosted" is Vercel or our AWS host (which sets APP_ENV). Off both, this is a
// dev box, where localhost links are the point.
const deployEnv = process.env.APP_ENV ?? process.env.VERCEL_ENV
const hosted = process.env.VERCEL === "1" || !!process.env.APP_ENV
const isProduction = hosted && deployEnv === "production"

export const APP_URL: string = resolveAppUrl(
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.NEXT_PUBLIC_VERCEL_URL,
  isProduction
    ? "www.deltechmun.in"
    : hosted
      ? undefined
      : process.env.VERCEL_PROJECT_PRODUCTION_URL,
  // Any hosted deployment, not just production: staging must not hand out
  // localhost links either.
  hosted,
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
