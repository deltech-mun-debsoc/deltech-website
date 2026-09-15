"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CircleCheck, QrCode, Send, ShieldCheck } from "lucide-react"
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
    detail: "The delegate scans a QR generated from the exact UPI ID below. Your team verifies it.",
  },
  razorpay: {
    label: "Razorpay",
    detail: "The delegate pays through their generated Razorpay link. Webhooks can confirm automatically.",
  },
  static_link: {
    label: "Fixed link",
    detail: "Every delegate receives the same external payment or proof form link.",
  },
} satisfies Record<Provider, { label: string; detail: string }>

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">{label}</Label>
      {children}
      {hint && <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>}
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
      <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="eyebrow">01 / How money moves</p>
          <h3 className="mt-3 font-heading text-3xl">Choose one clear route</h3>
          <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
            This is the source of truth for the pay page and allotment emails.
          </p>
        </div>
        <div className="space-y-3">
          <Select value={provider} onValueChange={(value) => setProvider(value as Provider)}>
            <SelectTrigger className="h-14 text-base">
              <span>{PROVIDERS[provider].label}</span>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDERS).map(([value, item]) => (
                <SelectItem key={value} value={value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="border-l-4 border-primary bg-primary/5 p-4 text-sm leading-relaxed">
            {PROVIDERS[provider].detail}
          </div>
        </div>
      </section>

      {provider === "upi_qr" && (
        <section className="grid gap-6 border-t border-border pt-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="flex size-11 items-center justify-center bg-ink text-paper"><QrCode /></div>
            <h3 className="mt-5 font-heading text-2xl">What exactly is that QR?</h3>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              It encodes this UPI ID, payee name, delegate token, and their exact fee. Delegates will see the identity beside the QR before scanning.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="UPI ID" hint="Example: tanmay@paytm. Double-check this before opening registration.">
              <Input value={upiVpa} onChange={(event) => setUpiVpa(event.target.value)} placeholder="name@bank" className="h-12 text-base" />
            </Field>
            <Field label="Payee name" hint="The human name delegates should see in their UPI app.">
              <Input value={upiPayeeName} onChange={(event) => setUpiPayeeName(event.target.value)} placeholder="DelTech MUN" className="h-12 text-base" />
            </Field>
          </div>
        </section>
      )}

      {provider === "static_link" && (
        <section className="border-t border-border pt-8">
          <Field label="Fixed payment link" hint="Use this only if every delegate should open exactly the same destination.">
            <Input value={staticLink} onChange={(event) => setStaticLink(event.target.value)} placeholder="https://…" className="h-12 text-base" />
          </Field>
        </section>
      )}

      <section className="border-t border-border pt-8">
        <div className="mb-6">
          <p className="eyebrow">02 / What delegates are told</p>
          <h3 className="mt-3 font-heading text-3xl">One source for every email</h3>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Field label="Payment deadline" hint="Written exactly as you want it shown in allotment emails.">
            <Input value={deadline} onChange={(event) => setDeadline(event.target.value)} placeholder="30 January 2027, 6:00 PM IST" className="h-12 text-base" />
          </Field>
          <Field label="Payment proof form" hint="Optional Google Form shown after payment. Leave blank if the website is the only verification route.">
            <Input value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="https://forms.gle/…" className="h-12 text-base" />
          </Field>
          <Field label="WhatsApp community" hint="Added to the payment-confirmation email after a delegate is officially confirmed.">
            <Input value={communityUrl} onChange={(event) => setCommunityUrl(event.target.value)} placeholder="https://chat.whatsapp.com/…" className="h-12 text-base" />
          </Field>
          <Field label="Secretariat reply email" hint="Used in automated emails for delegate questions.">
            <Input type="email" value={secretariatEmail} onChange={(event) => setSecretariatEmail(event.target.value)} placeholder="secretariat@…" className="h-12 text-base" />
          </Field>
          <div className="lg:col-span-2">
            <Field label="Refund policy">
              <Textarea value={refundPolicy} onChange={(event) => setRefundPolicy(event.target.value)} rows={3} className="text-base" />
            </Field>
          </div>
        </div>
      </section>

      <section className="grid gap-6 border-t border-border pt-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="eyebrow">03 / Operations</p>
          <h3 className="mt-3 font-heading text-2xl">Optional sheet mirror</h3>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">This mirrors allotment and payment changes. It does not control the QR.</p>
        </div>
        <Field label="Apps Script web app URL">
          <Input value={syncUrl} onChange={(event) => setSyncUrl(event.target.value)} placeholder="https://script.google.com/macros/s/…/exec" className="h-12 text-base" />
        </Field>
      </section>

      <div className="sticky bottom-5 z-10 flex flex-col gap-4 border border-border bg-background/95 p-5 shadow-xl backdrop-blur sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-3 text-sm text-muted-foreground">
          <ShieldCheck className="size-5 text-primary" />
          Public pay pages and future automated emails use these values after save.
        </div>
        <Button size="lg" onClick={save} disabled={isPending} className="min-w-48">
          {isPending ? <CircleCheck /> : <Send />}
          {isPending ? "Saving…" : "Save payment flow"}
        </Button>
      </div>
    </div>
  )
}
