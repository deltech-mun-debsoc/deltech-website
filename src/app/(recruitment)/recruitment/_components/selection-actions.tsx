"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, Loader2, Mail } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { t } from "@/content/strings"
import { cn } from "@/lib/utils"
import { sendSelectionEmails } from "../selection-email-actions"
import type { SelectionEmailStatus } from "../selection-email-actions"

// What you do once the decisions are in: take the list away as a spreadsheet, and
// tell the people who got in.
//
// Both live on the Candidates page rather than a separate screen, because that is
// where someone already is when the last decision is recorded.
export function SelectionActions({
  cycleId,
  canExport,
  email,
}: {
  cycleId: string
  canExport: boolean
  // null when the viewer may not send: the control is absent, not disabled.
  email: SelectionEmailStatus | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState(email)

  if (!canExport && !status) return null

  const exportHref = (params: string) =>
    `/api/admin/export?entity=candidates&cycleId=${encodeURIComponent(cycleId)}&${params}`

  function send() {
    if (!status) return
    if (
      !confirm(
        t("recruitment.selection.confirmSend", { count: status.pending }),
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await sendSelectionEmails(cycleId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (result.failed > 0) {
        toast.warning(t("recruitment.selection.sentPartial", { sent: result.sent, failed: result.failed }))
      } else if (result.sent === 0) {
        toast.info(t("recruitment.selection.sentNone"))
      } else {
        toast.success(t("recruitment.selection.sentAll", { sent: result.sent }))
      }
      setStatus({ ...status, pending: 0, alreadyEmailed: status.alreadyEmailed + result.sent })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canExport && (
        <>
          <a
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            href={exportHref("format=xlsx")}
          >
            <Download className="size-4" />
            {t("recruitment.selection.exportAll")}
          </a>
          <a
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            href={exportHref("status=SELECTED&format=xlsx")}
          >
            <Download className="size-4" />
            {t("recruitment.selection.exportSelected")}
          </a>
        </>
      )}

      {status && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="gap-1.5" disabled={pending || status.pending === 0} onClick={send}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            {t("recruitment.selection.emailSelected", { count: status.pending })}
          </Button>
          {/* Never a disabled control with no explanation: say which of the three
              reasons this is, because they need different things done about them. */}
          <p className="text-xs text-muted-foreground">
            {status.selected === 0
              ? t("recruitment.selection.noneSelected")
              : status.pending === 0
                ? t("recruitment.selection.allEmailed", { count: status.alreadyEmailed })
                : status.hasGroupLink
                  ? t("recruitment.selection.readyWithLink")
                  : t("recruitment.selection.readyNoLink")}
          </p>
        </div>
      )}
    </div>
  )
}
