import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { QRBlock } from "./_components/qr-block"
import { STRINGS } from "@/content/strings"
import { getContent } from "@/lib/settings"

export default async function PayPage(props: {
  params: Promise<{ token: string }>
}) {
  const { token } = await props.params

  // token = Delegate.publicToken (random, unguessable, never the row id)
  const delegate = await prisma.delegate.findUnique({
    where: { publicToken: token },
    include: {
      payment: true,
      allotment: {
        include: {
          portfolio: {
            include: {
              committee: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  // An unknown token really is a 404. But a *valid* token whose payment row is
  // missing is a different situation: the delegate is registered and simply has
  // nothing to pay yet, or an allotment half-completed. Showing them the
  // marketing "Page not found" card left them unable to tell whether their
  // money had gone somewhere or whether they were registered at all.
  if (!delegate) notFound()

  if (!delegate.payment) {
    return (
      <div className="paper-grid grid min-h-svh place-items-center px-4 py-20">
        <div className="editorial-card w-full max-w-md p-8 text-center">
          <p className="eyebrow text-gold-500">Payment</p>
          <h1 className="display mt-4 text-3xl">Nothing to pay yet</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {delegate.fullName}, your registration is on file, but no payment has been raised
            against it. That is normal before the secretariat publishes your allotment. If you were
            expecting a payment link, reply to your allotment email and we will sort it out.
          </p>
          <div className="rule my-6" />
          <Link
            href={`/status/${delegate.publicToken}`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Check your application status
          </Link>
        </div>
      </div>
    )
  }

  const content = await getContent()
  const { payment, allotment } = delegate
  const isPaid =
    ["PAID", "OFFLINE", "COMPED"].includes(payment.status) ||
    delegate.status === "CONFIRMED"

  // UPI intent string, only built when provider is upi_qr
  const upiString =
    payment.provider === "upi_qr"
      ? (() => {
          const vpa = content.upiVpa.trim()
          const payeeName = content.upiPayeeName.trim()
          if (!vpa || !payeeName) return null
          return (
            `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName)}` +
            `&am=${payment.amountInr.toFixed(2)}&tn=${encodeURIComponent(delegate.publicToken)}&cu=INR`
          )
        })()
      : null

  return (
    <div className="min-h-screen bg-[#eee9dd] px-4 py-8 sm:py-14">
      <div className="mx-auto grid max-w-5xl overflow-hidden border border-black/15 bg-background shadow-[18px_18px_0_rgba(15,118,110,0.22)] lg:grid-cols-[0.78fr_1.22fr]">
        <aside className="flex flex-col justify-between bg-ink p-7 text-paper sm:p-10">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-paper/55">{STRINGS.brand.name} / secure payment</p>
            <h1 className="mt-12 max-w-[8ch] font-heading text-5xl leading-[0.95] sm:text-6xl">Confirm your seat.</h1>
          </div>
          <div className="mt-14 border-t border-paper/20 pt-6">
            <p className="text-sm text-paper/55">Delegate</p>
            <p className="mt-1 text-xl font-semibold">{delegate.fullName}</p>
            <p className="mt-1 text-sm text-paper/60">{delegate.email}</p>
          </div>
        </aside>
        <main className="space-y-7 p-7 sm:p-10">
        {/* Header */}
        <div>
          <p className="eyebrow">Your allotment</p>
          <h2 className="mt-3 font-heading text-3xl">Review before paying</h2>
        </div>

        <Separator />

        {/* Allotment summary */}
        {allotment && (
          <div className="space-y-3 text-base">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Committee</span>
              <span className="font-medium">{allotment.portfolio.committee.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Portfolio</span>
              <span className="font-medium">{allotment.portfolio.name}</span>
            </div>
          </div>
        )}

        <Separator />

        {/* Amount */}
        <div className="flex items-end justify-between">
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Amount due</span>
          <span className="font-heading text-4xl">₹{payment.amountInr.toLocaleString("en-IN")}</span>
        </div>

        <Separator />

        {isPaid ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Badge className="text-sm">Payment Confirmed</Badge>
            <p className="text-center text-sm text-muted-foreground">
              Your payment has been received. You&apos;re all set!
            </p>
          </div>
        ) : payment.provider === "razorpay" && payment.paymentLink ? (
          /* ── Razorpay ── */
          <div className="flex flex-col items-center gap-4 py-2">
            <a
              href={payment.paymentLink}
              className={cn(buttonVariants({ size: "lg" }), "w-full")}
            >
              Pay ₹{payment.amountInr.toLocaleString("en-IN")} with Razorpay
            </a>
            <p className="text-center text-xs text-muted-foreground">
              Secured by Razorpay. Supports UPI, cards, netbanking, and wallets.
            </p>
          </div>
        ) : upiString ? (
          /* ── UPI QR ── */
          <>
            <QRBlock
              upiString={upiString}
              amountInr={payment.amountInr}
              payeeName={content.upiPayeeName}
              upiVpa={content.upiVpa}
            />

            <Separator />

            <div className="space-y-2 border-l-4 border-primary bg-primary/5 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">After paying:</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Screenshot your payment confirmation.</li>
                {content.paymentProofUrl ? (
                  <li><a className="font-semibold text-primary underline" href={content.paymentProofUrl}>Submit the payment screenshot here.</a></li>
                ) : (
                  <li>Your spot is held, no separate form is required.</li>
                )}
                <li>
                  We&apos;ll confirm your registration once we verify the payment (within 24 hrs).
                </li>
              </ol>
            </div>
          </>
        ) : (
          <div className="border border-destructive/30 bg-destructive/5 p-5">
            <p className="font-semibold">Payment is not configured yet.</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The secretariat has not published a valid payment destination. Do not transfer money to an unverified QR.
              {content.secretariatEmail && <> Contact <a className="font-semibold text-primary underline" href={"mailto:" + content.secretariatEmail}>{content.secretariatEmail}</a>.</>}
            </p>
          </div>
        )}
        {content.paymentDeadline && <p className="text-center text-sm text-muted-foreground">Payment deadline · <strong className="text-foreground">{content.paymentDeadline}</strong></p>}
        </main>
      </div>
    </div>
  )
}
