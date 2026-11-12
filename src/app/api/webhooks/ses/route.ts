import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { nextEmailStatus } from "@/lib/email-status"

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
  mail?: { destination?: string[]; messageId?: string }
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
//
// SNS delivers at least once, and one configuration set can feed more than one
// destination, so the same bounce arrives more than once in practice (seen on
// production: one send, two identical rows). The originating message id is
// carried in the row and checked first, so a repeat is dropped rather than
// shown to staff as a second failure. Suppression itself was always idempotent.
async function logAgainstAddress(email: string, status: string, error: string, messageId?: string): Promise<void> {
  const tag = messageId ? ` [ses:${messageId}]` : ""
  if (messageId) {
    const already = await prisma.emailLog.findFirst({
      where: { toEmail: email, status, error: { contains: `[ses:${messageId}]` } },
      select: { id: true },
    })
    if (already) return
  }
  const delegate = await prisma.delegate.findFirst({ where: { email }, select: { id: true }, orderBy: { createdAt: "desc" } })
  await prisma.emailLog.create({
    data: {
      delegateId: delegate?.id ?? null,
      template: "ses-event",
      toEmail: email,
      status,
      error: `${error.slice(0, 500 - tag.length)}${tag}`,
    },
  })
}

// The event is about one email we sent: write it onto that email (and onto the
// campaign recipient, if it was campaign mail) instead of adding an unrelated
// row. Returns false when nothing matches (mail sent before ids were stored),
// so the caller can fall back to logging against the address.
async function recordOnMessage(
  messageId: string | undefined,
  status: "DELIVERED" | "DEFERRED" | "BOUNCED" | "COMPLAINED",
  detail: string,
): Promise<boolean> {
  if (!messageId) return false
  const logs = await prisma.emailLog.findMany({ where: { providerMessageId: messageId }, select: { id: true, status: true } })
  for (const log of logs) {
    const next = nextEmailStatus(log.status, status)
    if (next !== log.status) {
      await prisma.emailLog.update({
        where: { id: log.id },
        data: { status: next, ...(status === "DELIVERED" ? {} : { error: detail.slice(0, 500) }) },
      })
    }
  }
  if (status === "BOUNCED" || status === "COMPLAINED") {
    await prisma.mailRecipient.updateMany({
      where: { providerMessageId: messageId, status: "SENT" },
      data: { status: "FAILED", error: `${status === "BOUNCED" ? "Bounced" : "Marked as spam"}: ${detail}`.slice(0, 500) },
    })
  }
  return logs.length > 0
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
  const messageId = event.mail?.messageId
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
      const status = permanent ? "BOUNCED" : "DEFERRED"
      const detail = r.diagnosticCode ?? `${event.bounce?.bounceType ?? "Bounce"}`
      if (!(await recordOnMessage(messageId, status, detail))) await logAgainstAddress(email, status, detail, messageId)
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
      const detail = event.complaint?.complaintFeedbackType ?? "complaint"
      if (!(await recordOnMessage(messageId, "COMPLAINED", detail))) await logAgainstAddress(email, "COMPLAINED", detail, messageId)
    }
    return NextResponse.json({ ok: true, handled: recipients.length })
  }

  // Delivered to the receiving server, or held up on the way. Only recorded when
  // the configuration set publishes them; until then an email reads "accepted
  // by the email service", never "delivered".
  if (kind === "Delivery" || kind === "DeliveryDelay") {
    const matched = await recordOnMessage(messageId, kind === "Delivery" ? "DELIVERED" : "DEFERRED", kind)
    return NextResponse.json({ ok: true, matched })
  }

  // Send, Open, Click and anything else SES may publish: acknowledged so SNS
  // stops, but nothing here acts on them.
  return NextResponse.json({ ok: true, ignored: kind || "unknown" })
}
