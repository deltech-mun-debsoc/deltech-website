"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cancelCampaign, duplicateCampaign, runQueueNow } from "../actions"

export function CampaignActions({ id, state, isAdmin, base }: { id: string; state: string; isAdmin: boolean; base: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [cancelOpen, setCancelOpen] = useState(false)
  const active = state === "DRAFT" || state === "SCHEDULED" || state === "SENDING"

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await duplicateCampaign(id)
            if (r.success) router.push(`${base}/${r.id}`)
            else toast.error(r.error)
          })
        }
      >
        Duplicate as a new draft
      </Button>
      {isAdmin && state === "SENDING" && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await runQueueNow()
              if (!r.success) toast.error(r.error)
              else toast.success(r.capped ? "Daily limit reached. The rest continue automatically." : `Sent ${r.sent} more.`)
              router.refresh()
            })
          }
        >
          Send the next batch now
        </Button>
      )}
      {isAdmin && active && (
        <Button variant="outline" size="sm" className="text-destructive" disabled={pending} onClick={() => setCancelOpen(true)}>
          Cancel mail
        </Button>
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(o) => !pending && setCancelOpen(o)}
        title={"Cancel this mail?"}
        description={"Nobody else gets it. Anyone it has already reached keeps their copy."}
        confirmLabel={"Cancel mail"}
        destructive
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await cancelCampaign(id)
            setCancelOpen(false)
            if (r.success) toast.success("Cancelled.")
            else toast.error(r.error)
            router.refresh()
          })
        }
      />
    </div>
  )
}
