import { createHmac, timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendPaymentConfirmed } from "@/lib/resend"
import { syncSheetForDelegate } from "@/lib/sheet-sync"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !/^[a-fA-F0-9]{64}$/.test(signature)) return false
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
  try {
    // timingSafeEqual requires equal-length buffers
    const a = Buffer.from(signature, "hex")
    const b = Buffer.from(expected, "hex")
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// Extract delegateId from wherever Razorpay puts it depending on event type
function extractDelegateId(event: string, payload: Record<string, unknown>): string | null {
  const p = payload as Record<string, { entity?: { notes?: Record<string, string>; id?: string } } | undefined>
  if (event === "payment_link.paid") {
    return p.payment_link?.entity?.notes?.delegateId ?? null
  }
  if (event === "order.paid") {
    return p.order?.entity?.notes?.delegateId ?? null
  }
  // payment.captured, payment.failed
  return p.payment?.entity?.notes?.delegateId ?? null
}

function extractRazorpayPaymentId(payload: Record<string, unknown>): string | null {
  const p = payload as Record<string, { entity?: { id?: string } } | undefined>
  return p.payment?.entity?.id ?? null
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Payment webhook is not configured" }, { status: 503 })
  }
  const rawBody = await req.text()
  const signature = req.headers.get("x-razorpay-signature") ?? ""
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? ""

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  let body: { event?: string; payload?: Record<string, unknown> }
  try {
    body = JSON.parse(rawBody) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { event, payload = {} } = body

  // Respond 200 immediately for unhandled events · Razorpay won't retry
  if (
    event !== "payment.captured" &&
    event !== "payment_link.paid" &&
    event !== "order.paid" &&
    event !== "payment.failed"
  ) {
    return NextResponse.json({ received: true })
  }

  const delegateId = extractDelegateId(event, payload)
  if (!delegateId) {
    // Can't identify the delegate, log and return 200 so Razorpay stops retrying
    console.warn(`[razorpay webhook] no delegateId in notes for event=${event}`)
    return NextResponse.json({ received: true })
  }

  const payment = await prisma.payment.findUnique({
    where: { delegateId },
    select: { id: true, status: true },
  })
  if (!payment) {
    console.warn(`[razorpay webhook] no payment found for delegateId=${delegateId}`)
    return NextResponse.json({ received: true })
  }

  if (event === "payment.failed") {
    // Idempotent: only update if still in a pre-failure state
    if (payment.status !== "PAID" && payment.status !== "OFFLINE" && payment.status !== "COMPED") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      })
    }
    return NextResponse.json({ received: true })
  }

  // payment.captured | payment_link.paid | order.paid → confirm
  //
  // All three mean "paid", and Razorpay fires payment.captured AND
  // payment_link.paid within milliseconds of each other for a single
  // payment-link payment. Reading the status and then writing unconditionally
  // let both deliveries through: two confirmation emails, two EmailLog rows,
  // confirmedAt written twice. So the WRITE is the guard, not the read.
  const razorpayPaymentId = extractRazorpayPaymentId(payload)

  const confirmed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { notIn: ["PAID", "OFFLINE", "COMPED"] } },
      data: {
        status: "PAID",
        confirmedAt: new Date(),
        ...(razorpayPaymentId ? { razorpayPaymentId } : {}),
      },
    })
    // Lost the race, or already settled by another route. Either way this
    // delivery has nothing to do and must not send a second email.
    if (count === 0) return false

    await tx.delegate.update({
      where: { id: delegateId },
      data: { status: "CONFIRMED" },
    })
    return true
  })

  if (!confirmed) return NextResponse.json({ received: true })

  await syncSheetForDelegate(delegateId)

  try {
    await sendPaymentConfirmed(delegateId)
  } catch {
    // email failure must not cause webhook retry
  }

  return NextResponse.json({ received: true })
}
