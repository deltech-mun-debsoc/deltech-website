import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { t } from "@/content/strings"
import { ConfirmCheckinButton } from "./_components/confirm-checkin-button"

const STATUS_LABEL: Record<string, string> = {
  REGISTERED: "Registered",
  ALLOTTED: "Allotted",
  PAYMENT_SENT: "Payment pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  WAITLISTED: "Waitlisted",
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  REGISTERED: "secondary",
  ALLOTTED: "outline",
  PAYMENT_SENT: "outline",
  CONFIRMED: "default",
  CANCELLED: "destructive",
  WAITLISTED: "secondary",
}

const PAY_STATUS_LABEL: Record<string, string> = {
  PENDING: "Awaiting payment",
  SENT: "Payment link sent",
  PAID: "Paid",
  OFFLINE: "Confirmed (UPI)",
  COMPED: "Comped",
  FAILED: "Payment failed",
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{value ?? "-"}</p>
    </div>
  )
}

export default async function CheckinTokenPage(props: {
  params: Promise<{ token: string }>
}) {
  const { token } = await props.params

  // token = Delegate.publicToken, same bearer credential used by /status/[token]
  // and /pay/[token]. This route additionally sits behind the (admin) layout's
  // requireStaff() gate, so reaching this page at all already proves staff auth.
  const delegate = await prisma.delegate.findUnique({
    where: { publicToken: token },
    include: {
      allotment: { include: { portfolio: { include: { committee: true } } } },
      payment: true,
    },
  })

  if (!delegate) notFound()

  const { allotment, payment } = delegate
  const isConfirmed = delegate.status === "CONFIRMED"

  return (
    <div className="mx-auto max-w-lg">
      <div className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("checkin.deskEyebrow")}
            </p>
            <h1 className="mt-1 text-xl font-bold">{delegate.fullName}</h1>
            <p className="text-sm text-muted-foreground">{delegate.email}</p>
          </div>
          <Badge variant={STATUS_VARIANT[delegate.status] ?? "secondary"}>
            {STATUS_LABEL[delegate.status] ?? delegate.status}
          </Badge>
        </div>

        {!isConfirmed && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {t("checkin.notConfirmedWarning")}
          </div>
        )}

        <Separator />

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("admin.table.headerCommittee")} value={allotment?.portfolio.committee.name} />
          <Field label={t("checkin.headerPortfolio")} value={allotment?.portfolio.name} />
          <Field label={t("checkin.dtuLabel")} value={delegate.isDtu ? t("common.yes") : t("common.no")} />
          <Field label={t("checkin.accommodationLabel")} value={delegate.needsAccommodation ? t("common.yes") : t("common.no")} />
          <div className="col-span-2">
            <Field
              label={t("admin.table.headerPayStatus")}
              value={payment ? (PAY_STATUS_LABEL[payment.status] ?? payment.status) : undefined}
            />
          </div>
        </div>

        <Separator />

        <ConfirmCheckinButton
          delegateId={delegate.id}
          checkedInAt={delegate.checkedInAt?.toISOString() ?? null}
          checkedInBy={delegate.checkedInBy}
        />
      </div>
    </div>
  )
}
