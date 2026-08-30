"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FastForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { t } from "@/content/strings"
import { bypassGd } from "../candidate-actions"

// Mirrors bypassGdSchema on the server (src/lib/schemas/recruitment.ts).
const MIN_REASON = 10

// GD bypass. The reason is mandatory (and enforced again server-side) because the
// bypass becomes a permanent audit event that a PI evaluator will read: "skipped,
// no reason given" would defeat the point.
//
// This button is only rendered for viewers who hold candidate.bypassGd; a JC never
// sees it, and would be refused by the server if they forged the call.
export function BypassGdButton({
  candidateId,
  candidateName,
}: {
  candidateId: string
  candidateName: string
  cycleId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()

  // The server refuses a reason under 10 characters, so the confirm button is
  // disabled until it would be accepted. That disabled state used to say nothing:
  // you typed "no time", the button stayed grey, and the only reading available
  // was that Skip GD is broken.
  const remaining = MIN_REASON - reason.trim().length

  function submit() {
    startTransition(async () => {
      const result = await bypassGd({ candidateId, reason })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(t("recruitment.candidates.bypassConfirm"))
      setOpen(false)
      setReason("")
      router.refresh()
    })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <FastForward className="size-3.5" />
        {t("recruitment.candidates.bypassGd")}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("recruitment.candidates.bypassGd")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{candidateName}</p>
            <div className="space-y-1.5">
              <Label htmlFor="bypass-reason">
                {t("recruitment.candidates.bypassReasonLabel")}
              </Label>
              <Textarea
                id="bypass-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby="bypass-reason-hint"
              />
              <p id="bypass-reason-hint" className="text-xs text-muted-foreground">
                {remaining > 0
                  ? t("recruitment.candidates.bypassReasonRemaining", { n: remaining })
                  : t("recruitment.candidates.bypassReasonReady")}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            {/* Matches the server minimum, so the button is never enabled for a
                request that would be refused. The hint above says why. */}
            <Button onClick={submit} disabled={pending || remaining > 0}>
              {t("recruitment.candidates.bypassConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
