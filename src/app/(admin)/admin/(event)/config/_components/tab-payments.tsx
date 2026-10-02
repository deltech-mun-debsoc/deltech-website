"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CircleCheck, Send, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { savePaymentConfig } from "../actions"

type Provider = "upi_qr" | "razorpay" | "static_link"

interface Props {
  paymentProvider: Provider
  staticPaymentLink: string
  upiVpa: string
  upiPayeeName: string
  paymentDeadline: string
  paymentProofUrl: string
  refundPolicy: string
  whatsappCommunityUrl: string
  secretariatEmail: string
  sheetSyncUrl: string
}

const PROVIDERS = {
  upi_qr: {
    label: "UPI QR",
    detail: "Delegate scans a QR for your UPI ID and their fee. Staff verify.",
  },
  razorpay: {
    label: "Razorpay",
    detail: "Per-delegate Razorpay link. Webhooks confirm automatically.",
  },
  static_link: {
    label: "Fixed link",
    detail: "Everyone gets the same external payment or proof link.",
  },
} satisfies Record<Provider, { label: string; detail: string }>

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function TabPayments(props: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [provider, setProvider] = useState<Provider>(props.paymentProvider)
  const [staticLink, setStaticLink] = useState(props.staticPaymentLink)
  const [upiVpa, setUpiVpa] = useState(props.upiVpa)
  const [upiPayeeName, setUpiPayeeName] = useState(props.upiPayeeName)
  const [deadline, setDeadline] = useState(props.paymentDeadline)
  const [proofUrl, setProofUrl] = useState(props.paymentProofUrl)
  const [refundPolicy, setRefundPolicy] = useState(props.refundPolicy)
  const [communityUrl, setCommunityUrl] = useState(props.whatsappCommunityUrl)
  const [secretariatEmail, setSecretariatEmail] = useState(props.secretariatEmail)
  const [syncUrl, setSyncUrl] = useState(props.sheetSyncUrl)

  function save() {
    if (provider === "static_link" && !staticLink.trim()) {
      toast.error("Add the fixed payment link first.")
      return
    }
    if (provider === "upi_qr" && (!upiVpa.trim() || !upiPayeeName.trim())) {
      toast.error("A QR is useless without both a UPI ID and payee name.")
      return
    }
    startTransition(async () => {
      const result = await savePaymentConfig({
        paymentProvider: provider,
        staticPaymentLink: staticLink.trim(),
        upiVpa: upiVpa.trim(),
        upiPayeeName: upiPayeeName.trim(),
        paymentDeadline: deadline.trim(),
        paymentProofUrl: proofUrl.trim(),
        refundPolicy: refundPolicy.trim(),
        whatsappCommunityUrl: communityUrl.trim(),
        secretariatEmail: secretariatEmail.trim(),
        sheetSyncUrl: syncUrl.trim(),
      })
      if (!result.success) {
        toast.error(result.error ?? "Failed to save.")
        return
      }
      toast.success("Payment flow and automated email details saved.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Payment method</h3>
        <div className="max-w-xl space-y-2">
          <Select value={provider} onValueChange={(value) => setProvider(value as Provider)}>
            <SelectTrigger className="w-full">
              <span>{PROVIDERS[provider].label}</span>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDERS).map(([value, item]) => (
                <SelectItem key={value} value={value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{PROVIDERS[provider].detail}</p>
        </div>
      </section>

      {provider === "upi_qr" && (
        <section className="space-y-3 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">UPI</h3>
          <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
            <Field label="UPI ID" hint="Encoded in every delegate's QR with their fee. Check it before registration opens.">
              <Input value={upiVpa} onChange={(event) => setUpiVpa(event.target.value)} placeholder="name@bank" />
            </Field>
            <Field label="Payee name" hint="Shown in the delegate's UPI app.">
              <Input value={upiPayeeName} onChange={(event) => setUpiPayeeName(event.target.value)} placeholder="DelTech MUN" />
            </Field>
          </div>
        </section>
      )}

      {provider === "static_link" && (
        <section className="border-t border-border pt-6">
          <Field label="Fixed payment link">
            <Input value={staticLink} onChange={(event) => setStaticLink(event.target.value)} placeholder="https://…" />
          </Field>
        </section>
      )}

      <section className="space-y-4 border-t border-border pt-6">
        <h3 className="text-sm font-semibold">Delegate emails</h3>
        <div className="grid gap-6 lg:grid-cols-2">
          <Field label="Payment deadline" hint="Shown as written in allotment emails.">
            <Input value={deadline} onChange={(event) => setDeadline(event.target.value)} placeholder="30 January 2027, 6:00 PM IST" />
          </Field>
          <Field label="Payment proof form" hint="Optional. Shown after payment.">
            <Input value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="https://forms.gle/…" />
          </Field>
          <Field label="WhatsApp community" hint="Sent once a delegate is confirmed.">
            <Input value={communityUrl} onChange={(event) => setCommunityUrl(event.target.value)} placeholder="https://chat.whatsapp.com/…" />
          </Field>
          <Field label="Secretariat reply email" hint="Reply-to for delegate questions.">
            <Input type="email" value={secretariatEmail} onChange={(event) => setSecretariatEmail(event.target.value)} placeholder="secretariat@…" />
          </Field>
          <div className="lg:col-span-2">
            <Field label="Refund policy">
              <Textarea value={refundPolicy} onChange={(event) => setRefundPolicy(event.target.value)} rows={3} />
            </Field>
          </div>
        </div>
      </section>

      <section className="max-w-xl border-t border-border pt-6">
        <Field label="Sheet mirror (Apps Script URL)" hint="Optional. Mirrors allotment and payment changes.">
          <Input value={syncUrl} onChange={(event) => setSyncUrl(event.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
        </Field>
      </section>

      <div className="sticky bottom-5 z-10 flex flex-col gap-4 border border-border bg-background/95 p-5 shadow-xl backdrop-blur sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-3 text-sm text-muted-foreground">
          <ShieldCheck className="size-5 text-primary" />
          Pay pages and emails use these after save.
        </div>
        <Button size="lg" onClick={save} disabled={isPending} className="min-w-48">
          {isPending ? <CircleCheck /> : <Send />}
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}
