import { NextRequest } from "next/server"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { safeLanding } from "@/lib/nav"

// Post-authentication dispatch. Every sign-in path (magic link, password,
// signup) sends the user here; this is the single place that resolves where
// they actually land, by role, honoring a sanitized intended destination.
// Not in the proxy matcher, it guards itself via auth().
//
// Redirects are path-only. On a self-hosted standalone server req.nextUrl is
// the bind address (http://0.0.0.0:3000), so an absolute Location built from it
// sends the browser nowhere.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) redirect("/signin")
  const role = (session.user as { role?: string } | undefined)?.role
  const to = req.nextUrl.searchParams.get("to")
  // Our public origin, so an absolute same-origin callbackUrl (what NextAuth's
  // bounce produces) is honored, while foreign origins fall back to role home.
  // The proxy in front (Vercel, or Caddy on AWS) sets X-Forwarded-Host.
  const host = req.headers.get("x-forwarded-host") ?? req.nextUrl.host
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.nextUrl.protocol.replace(/:$/, "")
  redirect(safeLanding(to, role, `${proto}://${host}`))
}
