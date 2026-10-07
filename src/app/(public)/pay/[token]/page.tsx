import Link from "next/link"
import { BrandBar } from "@/components/auth-stage"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { QRBlock } from "./_components/qr-block"
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
      <>
        <BrandBar />
        <div className="mx-auto w-full max-w-lg px-4 py-16">
          <h1 className="text-3xl font-semibold">Nothing to pay yet</h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {delegate.fullName}, your registration is on file. The payment link comes with your allotment email.
          </p>
          <Link href={`/status/${delegate.publicToken}`} className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>
            Check your application status
          </Link>
        </div>
      </>
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
    <>
      <BrandBar />
      <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-12 sm:py-16">
          <div>
            <p className="text-sm text-muted-foreground">{delegate.fullName} · {delegate.email}</p>
            <h1 className="mt-1 text-3xl font-semibold">
              {isPaid ? "Payment received" : <>Pay ₹{payment.amountInr.toLocaleString("en-IN")}</>}
            </h1>
          </div>

          {allotment && (
            <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 text-base">
              <div><dt className="text-sm text-muted-foreground">Committee</dt><dd className="font-medium">{allotment.portfolio.committee.name}</dd></div>
              <div><dt className="text-sm text-muted-foreground">Portfolio</dt><dd className="font-medium">{allotment.portfolio.name}</dd></div>
            </dl>
          )}

          {!isPaid && content.paymentDeadline && <p className="text-sm text-muted-foreground">Pay by <strong className="text-foreground">{content.paymentDeadline}</strong></p>}

          {isPaid ? (
            <p className="text-base text-muted-foreground">Your seat is confirmed.</p>
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

              <div className="space-y-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
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
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
              <p className="font-semibold">Payment is not configured yet.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                The secretariat has not published a valid payment destination. Do not transfer money to an unverified QR.
                {content.secretariatEmail && <> Contact <a className="font-semibold text-primary underline" href={"mailto:" + content.secretariatEmail}>{content.secretariatEmail}</a>.</>}
              </p>
            </div>
          )}
      </div>
    </>
  )
}
