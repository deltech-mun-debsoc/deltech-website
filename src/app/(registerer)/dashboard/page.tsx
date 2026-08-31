import { formatDate } from "@/lib/datetime"
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buttonVariants } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { AccountLink } from "@/components/account-link";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { t } from "@/content/strings";
import { getContent } from "@/lib/settings";
import { STATUS_LABEL, STATUS_VARIANT, PAY_STATUS_LABEL } from "@/lib/status-labels";
import { deriveEventState } from "@/lib/event-state";
import { publicPaymentLink } from "@/lib/payments/public-link";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{value ?? "-"}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const email = session!.user.email!;

  const delegate = await prisma.delegate.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    include: {
      payment: true,
      coDelegate: true,
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
    orderBy: { createdAt: "desc" },
  });
  const content = await getContent();
  const paymentsRequired = deriveEventState(content).paymentsRequired;

  const { payment, allotment } = delegate ?? {};
  const needsPayment =
    paymentsRequired &&
    payment &&
    (payment.status === "PENDING" || payment.status === "SENT") &&
    payment.paymentLink;
  const payLink = delegate && payment?.paymentLink
    ? publicPaymentLink(payment.paymentLink, delegate.publicToken)
    : null;
  const isConfirmed = delegate?.status === "CONFIRMED";

  return (
    <div className="min-h-svh bg-muted/30">
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b border-border/60 bg-background px-4 sm:px-6">
        <span className="text-sm font-medium text-muted-foreground">
          {t("brand.name")} <span className="text-border">-</span>{" "}
          {t("dashboard.title")}
        </span>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:block">{email}</span>
          <AccountLink />
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-10">
        {!delegate ? (
          /* ── No registration found ── */
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm text-center space-y-4">
            <p className="text-lg font-semibold">{t("dashboard.noRegistration")}</p>
            <p className="text-sm text-muted-foreground">{t("dashboard.noRegistrationNote")}</p>
            <Link
              href="/register"
              className={cn(buttonVariants(), "mt-2")}
            >
              {t("dashboard.registerButton")}
            </Link>
          </div>
        ) : (
          /* ── Application found ── */
          <div className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("brand.name")}. Application Status
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
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                {t("dashboard.allotmentSection")}
              </p>
              {allotment ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Committee" value={allotment.portfolio.committee.name} />
                  <Field label="Portfolio" value={allotment.portfolio.name} />
                  {allotment.portfolio.committee.agenda && (
                    <div className="col-span-2">
                      <Field label="Agenda" value={allotment.portfolio.committee.agenda} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("dashboard.notAllottedYet")}</p>
              )}
            </div>

            {/* Co-delegate */}
            {delegate.coDelegate && (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Co-delegate
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name" value={delegate.coDelegate.fullName} />
                    <Field label="Email" value={delegate.coDelegate.email} />
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Payment */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                {paymentsRequired ? t("dashboard.paymentSection") : "Event fee"}
              </p>
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
                      ✓ {t("dashboard.confirmedMessage")}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {paymentsRequired
                    ? t("dashboard.paymentPendingNote")
                    : "No payment is required for this free Intra MUN. Your allotment confirms your place automatically."}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
