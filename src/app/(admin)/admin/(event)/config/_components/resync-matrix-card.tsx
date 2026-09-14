"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { resyncMatrix } from "../actions"

// Manual reconcile for the public Google Sheet mirror. Cell syncs are
// best-effort and self-heal on the next state change, so a stable cell can
// drift if the mirror was down when it was last set, this replays them all.
export function ResyncMatrixCard() {
  const [isPending, startTransition] = useTransition()

  const resync = () => {
    startTransition(async () => {
      const result = await resyncMatrix()
      if (result.success) {
        toast.success(`Resynced ${result.synced} allotted ${result.synced === 1 ? "cell" : "cells"} to the sheet.`)
      } else {
        toast.error(result.error ?? "Resync failed.")
      }
    })
  }

  return (
    <div className="editorial-card flex items-center justify-between gap-4 p-6">
      <div>
        <h2 className="font-heading text-lg">Resync public sheet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Replays every allotted portfolio’s current state to the mirrored Google Sheet. Use this
          if the sheet looks out of date after the sync endpoint was unavailable.
        </p>
      </div>
      <Button variant="outline" onClick={resync} disabled={isPending} className="shrink-0">
        {isPending ? "Resyncing…" : "Resync now"}
      </Button>
    </div>
  )
}
