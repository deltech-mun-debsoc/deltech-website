"use client"

import { QRCodeSVG } from "qrcode.react"
import { t } from "@/content/strings"

interface Props {
  checkinUrl: string
}

// Mirrors pay/[token]/_components/qr-block.tsx's card treatment. Encodes a
// direct link to /admin/checkin/<token>, a staff member's own phone camera
// app decodes and opens it like any QR link; no in-app scanner needed.
export function CheckinQR({ checkinUrl }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs font-semibold text-primary">
        {t("checkin.qrHeading")}
      </p>
      <div className="relative rounded-lg border border-border bg-white p-5">
        <QRCodeSVG value={checkinUrl} size={200} level="H" />
      </div>
      <p className="text-sm text-muted-foreground">{t("checkin.qrCaption")}</p>
    </div>
  )
}
