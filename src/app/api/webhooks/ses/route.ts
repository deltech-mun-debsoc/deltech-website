import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// SES bounce and complaint events, delivered by SNS from the configuration set
// named in SES_CONFIGURATION_SET.
//
// AWS requires a process for these, and without one the damage is silent: a
// bounced address stays in the outreach list and is mailed again on every
// campaign, which is exactly what drives a sending account's reputation down and
// gets it put back in the sandbox. MailContact.bouncedAt already excludes an
// address from every audience (src/lib/mailer/audience.ts); nothing wrote it
// until this route existed.
//
// Authenticated by a shared secret in the query string, the same approach as the
// Google Form webhook, because the SNS subscription URL is configured once in the
// AWS console: https://<host>/api/webhooks/ses?key=<SES_WEBHOOK_SECRET>
//
// Always answers 200 for anything it understands, including events it chooses to
// ignore, so SNS does not retry a message that was handled deliberately.

function secretOk(req: NextRequest): boolean {
  const secret = process.env.SES_WEBHOOK_SECRET ?? ""
  const given = req.nextUrl.searchParams.get("key") ?? ""
  if (!secret || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

// SNS confirms a subscription by asking us to fetch a URL it supplies. That URL
// is attacker-controlled input until proven otherwise, so only a real SNS
// endpoint is ever fetched.
function isSnsUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)
  } catch {
    return false
  }
}

interface SesEvent {
  eventType?: string
  notificationType?: string
  mail?: { destination?: string[] }
  bounce?: {
    bounceType?: string
    bouncedRecipients?: { emailAddress?: string; diagnosticCode?: string }[]
  }
  complaint?: {
    complainedRecipients?: { emailAddress?: string }[]
    complaintFeedbackType?: string
  }
}

// One row per address, so a bounce is visible in the delegate drawer's email
// history rather than only in the contacts list.
async function logAgainstAddress(email: string, status: string, error: string): Promise<void> {
  const delegate = await prisma.delegate.findFirst({ where: { email }, select: { id: true }, orderBy: { createdAt: "desc" } })
  await prisma.emailLog.create({
    data: { delegateId: delegate?.id ?? null, template: "ses-event", toEmail: email, status, error: error.slice(0, 500) },
  })
}

export async function POST(req: NextRequest) {
  if (!secretOk(req)) return new NextResponse("Unauthorized", { status: 401 })

  const raw = await req.text().catch(() => "")
  let envelope: Record<string, unknown>
  try {
    envelope = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return new NextResponse("Bad request", { status: 400 })
  }

  const type = (req.headers.get("x-amz-sns-message-type") ?? envelope.Type) as string | undefined

  if (type === "SubscriptionConfirmation") {
    const subscribeUrl = typeof envelope.SubscribeURL === "string" ? envelope.SubscribeURL : ""
    if (!isSnsUrl(subscribeUrl)) return new NextResponse("Unexpected subscribe URL", { status: 400 })
    await fetch(subscribeUrl).catch(() => {})
    return NextResponse.json({ ok: true, confirmed: true })
  }

  if (type === "UnsubscribeConfirmation") return NextResponse.json({ ok: true })

  let event: SesEvent
  try {
    event = JSON.parse(typeof envelope.Message === "string" ? envelope.Message : "{}") as SesEvent
  } catch {
    return new NextResponse("Bad request", { status: 400 })
  }

  const kind = event.eventType ?? event.notificationType ?? ""
  const now = new Date()

  if (kind === "Bounce") {
    const permanent = event.bounce?.bounceType === "Permanent"
    const recipients = event.bounce?.bouncedRecipients ?? []
    for (const r of recipients) {
      const email = r.emailAddress?.trim().toLowerCase()
      if (!email) continue
      // A transient bounce is a full mailbox or a greylist, not a dead address,
      // so it is recorded but never suppresses the address.
      if (permanent) {
        await prisma.mailContact.updateMany({ where: { email, bouncedAt: null }, data: { bouncedAt: now } })
      }
      await logAgainstAddress(
        email,
        permanent ? "BOUNCED" : "DEFERRED",
        r.diagnosticCode ?? `${event.bounce?.bounceType ?? "Bounce"}`,
      )
    }
    return NextResponse.json({ ok: true, handled: recipients.length })
  }

  if (kind === "Complaint") {
    const recipients = event.complaint?.complainedRecipients ?? []
    for (const r of recipients) {
      const email = r.emailAddress?.trim().toLowerCase()
      if (!email) continue
      // Somebody pressed "this is spam". Never mail them again: that is both the
      // decent response and what keeps the complaint rate survivable.
      await prisma.mailContact.updateMany({
        where: { email, unsubscribedAt: null },
        data: { unsubscribedAt: now },
      })
      await logAgainstAddress(email, "COMPLAINED", event.complaint?.complaintFeedbackType ?? "complaint")
    }
    return NextResponse.json({ ok: true, handled: recipients.length })
  }

  // Delivery, Send, Open, Click and anything else SES may publish: acknowledged
  // so SNS stops, but nothing here acts on them.
  return NextResponse.json({ ok: true, ignored: kind || "unknown" })
}
