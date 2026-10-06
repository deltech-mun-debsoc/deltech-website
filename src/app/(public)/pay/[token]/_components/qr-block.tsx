"use client"

import { QRCodeSVG } from "qrcode.react"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

interface Props {
  upiString: string
  amountInr: number
  payeeName: string
  upiVpa: string
}

export function QRBlock({ upiString, amountInr, payeeName, upiVpa }: Props) {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative bg-white p-5 shadow-[10px_10px_0_#0f766e]">
        <QRCodeSVG value={upiString} size={236} level="H" />
      </div>

      <div className="w-full border-y border-border py-4 text-center">
        <p className="text-xs font-bold text-muted-foreground">This QR pays</p>
        <p className="mt-2 text-xl font-bold">{payeeName}</p>
        <p className="mt-1 font-mono text-sm text-primary">{upiVpa}</p>
      </div>

      <a
        href={upiString}
        className={cn(buttonVariants({ size: "lg" }), "h-12 w-full max-w-xs text-base")}
      >
        Open in UPI App
      </a>

      <p className="text-sm text-muted-foreground">
        Exact amount · <strong className="text-foreground">₹{amountInr.toLocaleString("en-IN")}</strong>
        {" "}· GPay · PhonePe · Paytm · BHIM
      </p>
    </div>
  )
}
