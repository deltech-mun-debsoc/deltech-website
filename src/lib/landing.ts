import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { safeLanding } from "@/lib/nav"

// Where a signed-in visitor belongs, or null when there is no usable session.
// The one dispatcher behind /go and the sign-in, staff and signup doors.
//
// Null also covers a cookie that still decodes but names an account that is gone
// or disabled: a user deleted inside the session refresh window, or on localhost a
// cookie minted by another app on another port (cookies ignore ports) against a
// different database. Bouncing that visitor on from /signin sent them to a guard
// that sent them straight back, which is ERR_TOO_MANY_REDIRECTS. A page cannot
// clear the cookie, so the door shows its form instead; signing in overwrites it.
export async function landingFor(to: string | string[] | null | undefined): Promise<string | null> {
  const session = await auth()
  const id = session?.user?.id
  if (!id) return null

  const user = await prisma.user.findUnique({ where: { id }, select: { disabledAt: true, emailVerified: true } })
  if (!user || user.disabledAt || !user.emailVerified) return null

  // Our public origin, so an absolute same-origin callbackUrl (what the proxy's
  // bounce produces) is honoured. Caddy sets X-Forwarded-Host on the AWS boxes.
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http"
  const raw = Array.isArray(to) ? to[0] : to
  return safeLanding(raw, session.user.role, host ? `${proto}://${host}` : null)
}
