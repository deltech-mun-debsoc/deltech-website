import { formatDate } from "@/lib/datetime"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import Link from "next/link"
import { STRINGS } from "@/content/strings"
import { getContent } from "@/lib/settings"
import { STATUS_LABEL, STATUS_VARIANT, PAY_STATUS_LABEL } from "@/lib/status-labels"
import { CheckinQR } from "./_components/checkin-qr"
import { APP_URL } from "@/lib/app-url"
import { deriveEventState } from "@/lib/event-state"
import { publicPaymentLink } from "@/lib/payments/public-link"



function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
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

  const { payment, allotment } = delegate
  const needsPayment =
    paymentsRequired && payment && (payment.status === "PENDING" || payment.status === "SENT") && payment.paymentLink
  const payLink = payment?.paymentLink
    ? publicPaymentLink(payment.paymentLink, delegate.publicToken)
    : null
  const isConfirmed = delegate.status === "CONFIRMED"

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {STRINGS.brand.name}. Application Status
            </p>
            <h1 className="mt-1 text-xl font-bold">{delegate.fullName}</h1>
            <p className="text-sm text-muted-foreground">{delegate.email}</p>
          </div>
          <Badge variant={STATUS_VARIANT[delegate.status] ?? "secondary"}>
            {STATUS_LABEL[delegate.status] ?? delegate.status}
          </Badge>
        </div>

        <Separator />

        {/* Allotment */}
        {allotment ? (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
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
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Allotment
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Not yet allotted. You&apos;ll receive your committee and portfolio once the admin
              reviews your application.
            </p>
          </div>
        )}

        <Separator />

        {/* Payment */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{paymentsRequired ? "Payment" : "Event fee"}</p>
          {paymentsRequired && payment ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Amount"
                  value={`₹${payment.amountInr.toLocaleString("en-IN")}`}
                />
                <Field
                  label="Status"
                  value={PAY_STATUS_LABEL[payment.status] ?? payment.status}
                />
                {isConfirmed && payment.confirmedAt && (
                  <Field
                    label="Confirmed on"
                    value={formatDate(payment.confirmedAt)}
                  />
                )}
              </div>

              {needsPayment && (
                <Link
                  href={payLink!}
                  className={cn(buttonVariants({ size: "lg" }), "w-full")}
                >
                  Pay Now · ₹{payment.amountInr.toLocaleString("en-IN")}
                </Link>
              )}

              {isConfirmed && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  ✓ Your registration is confirmed. See you at the conference!
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {paymentsRequired
                ? "Payment details will appear here once you have been allotted a committee."
                : "No payment is required for this free Intra MUN. Your allotment confirms your place automatically."}
            </p>
          )}
        </div>

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
              This link is unique to you, keep it safe.{" "}
              <Link
                href="/signin"
                className="text-primary underline-offset-2 hover:underline"
              >
                Sign in
              </Link>{" "}
              to access your account.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
