import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getContent } from "@/lib/settings"
import { requireStaff } from "@/lib/authz"
import { TabFees } from "../_components/tab-fees"
import { TabPayments } from "../_components/tab-payments"

export default async function MoneySettingsPage() {
  const session = await requireStaff()
  const isAdmin = (session.user as { role?: string }).role === "ADMIN"

  const [content, fees] = await Promise.all([
    getContent(),
    prisma.fee.findMany({ orderBy: [{ committeeType: "asc" }, { isDtu: "asc" }] }),
  ])

  const serializedFees = fees.map((f) => ({
    id: f.id,
    label: f.label,
    committeeType: f.committeeType,
    isDtu: f.isDtu,
    amountInr: f.amountInr,
  }))

  return (
    <div className="space-y-6">
      {!content.paymentsEnabled && (
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {"This event is free, so nothing on this page is used. Allotting a seat confirms the delegate straight away. Switch on payments in "}
          <Link href="/admin/config#event-website" className="font-medium text-foreground underline underline-offset-2">Event control</Link>
          {" if it should charge."}
        </p>
      )}
      <div className="editorial-card p-7">
        <h2 className="font-heading text-2xl">Fees</h2>
        <p className="mt-2 text-base text-muted-foreground">
          Amounts by committee type, allotments always read from this table.
        </p>
        <div className="rule my-5" />
        <TabFees fees={serializedFees} />
      </div>

      {isAdmin ? (
        <div className="editorial-card p-7">
          <h2 className="font-heading text-2xl">Payment and email control</h2>
          <p className="mt-2 text-base text-muted-foreground">
            Configure exactly who the QR pays, what delegates are told, and where confirmed delegates go next. Admin only.
          </p>
          <div className="rule my-5" />
          <TabPayments
            paymentProvider={content.paymentProvider}
            staticPaymentLink={content.staticPaymentLink}
            upiVpa={content.upiVpa}
            upiPayeeName={content.upiPayeeName}
            paymentDeadline={content.paymentDeadline}
            paymentProofUrl={content.paymentProofUrl}
            refundPolicy={content.refundPolicy}
            whatsappCommunityUrl={content.whatsappCommunityUrl}
            secretariatEmail={content.secretariatEmail}
            sheetSyncUrl={content.sheetSyncUrl}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Payment provider settings are admin-only.
        </p>
      )}
    </div>
  )
}
