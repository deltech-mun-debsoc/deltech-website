import { formatDate } from "@/lib/datetime"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import Link from "next/link"
import { BrandBar } from "@/components/auth-stage"
import { getContent } from "@/lib/settings"
import { STATUS_LABEL, STATUS_VARIANT, PAY_STATUS_LABEL } from "@/lib/status-labels"
import { CheckinQR } from "./_components/checkin-qr"
import { APP_URL } from "@/lib/app-url"
import { deriveEventState } from "@/lib/event-state"
import { publicPaymentLink } from "@/lib/payments/public-link"



function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{value ?? "-"}</p>
    </div>
  )
}

export default async function StatusPage(props: {
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
              committee: { select: { name: true, agenda: true } },
            },
          },
        },
      },
    },
  })

  if (!delegate) notFound()
  const content = await getContent()
  const paymentsRequired = deriveEventState(content).paymentsRequired

  const session = await auth()
  const isOwner = session?.user?.email?.toLowerCase() === delegate.email.toLowerCase()

  // A draft allotment (not emailed yet) is staff-only: until it is sent the
  // delegate sees no seat, no payment and the status they had before it.
  const draft = !!delegate.allotment && !delegate.allotment.emailSentAt
  const allotment = draft ? null : delegate.allotment
  const payment = draft ? null : delegate.payment
  const status = draft ? "REGISTERED" : delegate.status
  const needsPayment =
    paymentsRequired && payment && (payment.status === "PENDING" || payment.status === "SENT") && payment.paymentLink
  const payLink = payment?.paymentLink
    ? publicPaymentLink(payment.paymentLink, delegate.publicToken)
    : null
  const isConfirmed = status === "CONFIRMED"

  return (
    <>
      <BrandBar />
      <div className="mx-auto w-full max-w-lg px-4 py-12">
        <div className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div>
              <h1 className="text-xl font-semibold">{delegate.fullName}</h1>
              <p className="break-all text-sm text-muted-foreground">{delegate.email}</p>
            </div>
            <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
              {STATUS_LABEL[status] ?? status}
            </Badge>
          </div>

          <Separator />

          {/* Allotment */}
          {allotment ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold">
                Allotment
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Committee" value={allotment.portfolio.committee.name} />
                <Field label="Portfolio" value={allotment.portfolio.name} />
                {allotment.portfolio.committee.agenda && (
                  <div className="col-span-2">
                    <Field label="Agenda" value={allotment.portfolio.committee.agenda} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold">
                Allotment
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Not allotted yet. You will be emailed when you are.
              </p>
            </div>
          )}

          {paymentsRequired && (
            <>
              <Separator />
              <div className="space-y-3">
                <p className="text-sm font-semibold">Payment</p>
                {payment ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Amount" value={`₹${payment.amountInr.toLocaleString("en-IN")}`} />
                      <Field label="Status" value={PAY_STATUS_LABEL[payment.status] ?? payment.status} />
                      {isConfirmed && payment.confirmedAt && (
                        <Field label="Confirmed on" value={formatDate(payment.confirmedAt)} />
                      )}
                    </div>
                    {needsPayment && (
                      <Link href={payLink!} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
                        Pay ₹{payment.amountInr.toLocaleString("en-IN")}
                      </Link>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Shown after allotment.</p>
                )}
              </div>
            </>
          )}

          {/* Check-in QR, only once the delegate is confirmed to attend */}
          {isConfirmed && (
            <>
              <Separator />
              <CheckinQR checkinUrl={`${APP_URL}/admin/checkin/${delegate.publicToken}`} />
            </>
          )}

          {/* Login prompt for guests */}
          {!isOwner && (
            <>
              <Separator />
              <p className="text-center text-xs text-muted-foreground">
                <Link href="/signin" className="text-primary underline-offset-2 hover:underline">
                  Sign in
                </Link>{" "}
                with this email to see it any time.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
