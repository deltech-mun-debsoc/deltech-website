"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cancelCampaign, duplicateCampaign, runQueueNow } from "../actions"

export function CampaignActions({
  id,
  state,
  isAdmin,
  base,
  canSendBatch = false,
}: {
  id: string
  state: string
  isAdmin: boolean
  base: string
  // Only while this mail has people waiting and the daily limit has room.
  canSendBatch?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [cancelOpen, setCancelOpen] = useState(false)
  const active = state === "DRAFT" || state === "SCHEDULED" || state === "SENDING"

  // A draft has never been sent to anyone, so offering to "cancel" it, and warning
  // that "anyone it has already reached keeps their copy", described something
  // that had not happened. Each state gets the words that are true of it.
  const stop =
    state === "DRAFT"
      ? {
          button: "Discard draft",
          title: "Discard this draft?",
          body: "Nothing was ever sent. The draft leaves your list, and you can still duplicate it from there if you want it back.",
          confirm: "Discard draft",
          done: "Draft discarded.",
        }
      : state === "SCHEDULED"
        ? {
            button: "Cancel send",
            title: "Cancel this scheduled mail?",
            body: "It will not go out at its scheduled time. Nobody has received it yet.",
            confirm: "Cancel send",
            done: "Send cancelled.",
          }
        : {
            button: "Stop sending",
            title: "Stop sending this mail?",
            body: "Nobody else gets it. Anyone it has already reached keeps their copy.",
            confirm: "Stop sending",
            done: "Stopped. Nobody else will get it.",
          }

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
        {state === "DRAFT" ? "Duplicate" : "Duplicate as a new draft (goes to everyone again)"}
      </Button>
      {isAdmin && canSendBatch && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await runQueueNow(id)
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
          {stop.button}
        </Button>
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(o) => !pending && setCancelOpen(o)}
        title={stop.title}
        description={stop.body}
        confirmLabel={stop.confirm}
        destructive
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await cancelCampaign(id)
            setCancelOpen(false)
            if (r.success) toast.success(stop.done)
            else toast.error(r.error)
            router.refresh()
          })
        }
      />
    </div>
  )
}
