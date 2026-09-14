import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyUnsubscribeToken } from "@/lib/mailer/unsubscribe"
import { APP_URL } from "@/lib/app-url"

// Two callers. Mail providers send a one-click POST (RFC 8058) from the
// List-Unsubscribe header, with the body "List-Unsubscribe=One-Click", and expect
// a plain success. A person using the button on /unsubscribe/<token> is sent back
// to that page to see it worked.
//
// Idempotent: unsubscribing twice keeps the first time.
//
// Redirects are built from APP_URL, never req.url. Behind the standalone server
// req.url is the bind address, so a redirect built from it sent people to
// https://0.0.0.0:3000 (found on staging).
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const contactId = verifyUnsubscribeToken(token, process.env.AUTH_SECRET ?? "")
  const body = await req.text().catch(() => "")
  const oneClick = body.includes("List-Unsubscribe=One-Click")

  if (!contactId) {
    return oneClick
      ? new NextResponse("Invalid unsubscribe link.", { status: 400 })
      : NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, APP_URL), 303)
  }

  await prisma.mailContact.updateMany({
    where: { id: contactId, unsubscribedAt: null },
    data: { unsubscribedAt: new Date() },
  })

  return oneClick
    ? new NextResponse("Unsubscribed.", { status: 200 })
    : NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}?done=1`, APP_URL), 303)
}
