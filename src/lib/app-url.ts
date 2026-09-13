// The origin this deployment puts in outbound links: status pages, payment
// links, check-in QR codes, blog links, quiz join URLs.
//
// Each consumer used to read NEXT_PUBLIC_APP_URL directly, defaulting to "".
// Keeping the decision here makes production and staging use their own origin
// consistently in email, payment links, QR codes and client-side presenters.
//
//   Production   NEXT_PUBLIC_APP_URL = https://www.deltechmun.in
//   Staging      NEXT_PUBLIC_APP_URL = https://test.deltechmun.in
//
// The variable is NEXT_PUBLIC_, so this resolves identically on the server and
// in the one client component that needs it (the quiz presenter).

/** Pure so scripts/check-app-url.ts can pin the fallback order. */
export function resolveAppUrl(
  explicit: string | undefined,
  hosted = false,
): string {
  const set = explicit?.trim()
  const localExplicit = set ? isLoopback(set) : false
  if (set && !(hosted && localExplicit)) {
    return canonicalizeProductionDomain(stripTrailingSlash(set))
  }

  // Keep localhost useful in local development. An AWS deployment is never
  // allowed to emit a loopback link: a QR
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

function canonicalizeProductionDomain(value: string): string {
  try {
    const url = new URL(value)
    if (url.hostname === "deltechmun.in") url.hostname = "www.deltechmun.in"
    return stripTrailingSlash(url.toString())
  } catch {
    return value
  }
}

// APP_ENV is set in every AWS image. Off AWS this is a dev box, where localhost
// links are useful. On AWS a missing/loopback NEXT_PUBLIC_APP_URL fails closed:
// callers receive no absolute origin rather than a plausible production link.
const hosted = !!process.env.APP_ENV

export const APP_URL: string = resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL, hosted)

/**
 * Where this deployment's documentation lives. Production has its own
 * subdomain; staging and local development serve the same pages under /docs.
 * Pure so scripts/check-app-url.ts can pin it.
 */
export function resolveDocsUrl(appUrl: string): string {
  if (appUrl === "https://www.deltechmun.in") return "https://docs.deltechmun.in"
  return `${appUrl}/docs`
}

export const DOCS_URL: string = resolveDocsUrl(APP_URL)

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
